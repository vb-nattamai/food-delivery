package com.fooddelivery.order.service;

import com.fooddelivery.order.model.Order;
import com.fooddelivery.order.model.OrderStatus;
import com.stripe.Stripe;
import com.stripe.exception.StripeException;
import com.stripe.model.PaymentIntent;
import com.stripe.model.Refund;
import com.stripe.param.PaymentIntentCreateParams;
import com.stripe.param.RefundCreateParams;
import jakarta.annotation.PostConstruct;
import jakarta.persistence.EntityNotFoundException;
import jakarta.transaction.Transactional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

@Service
public class OrderService {

    private static final Logger log = LoggerFactory.getLogger(OrderService.class);

    private static final String EXCHANGE = "order.events";

    private final OrderRepository orderRepository;
    private final RabbitTemplate rabbitTemplate;

    @Value("${stripe.api-key}")
    private String stripeApiKey;

    public OrderService(OrderRepository orderRepository, RabbitTemplate rabbitTemplate) {
        this.orderRepository = orderRepository;
        this.rabbitTemplate = rabbitTemplate;
    }

    @PostConstruct
    void initStripe() {
        Stripe.apiKey = stripeApiKey;
    }

    // ─── Create order ─────────────────────────────────────────────────────────

    @Transactional
    public Order createOrder(Order order) throws StripeException {
        order.setStatus(OrderStatus.PENDING);

        // Create a Stripe PaymentIntent for the order total (amount in cents)
        long amountCents = order.getTotalAmount()
                .multiply(BigDecimal.valueOf(100))
                .longValueExact();

        PaymentIntentCreateParams params = PaymentIntentCreateParams.builder()
                .setAmount(amountCents)
                .setCurrency("usd")
                .setCaptureMethod(PaymentIntentCreateParams.CaptureMethod.MANUAL)
                .putMetadata("orderId", order.getId() != null ? order.getId().toString() : "pending")
                .putMetadata("customerId", order.getCustomerId().toString())
                .build();

        PaymentIntent intent = PaymentIntent.create(params);
        order.setStripePaymentIntentId(intent.getId());

        Order saved = orderRepository.save(order);

        publishEvent("order.created", saved);
        log.info("Order created: {} with PaymentIntent: {}", saved.getId(), intent.getId());
        return saved;
    }

    // ─── Retrieve ─────────────────────────────────────────────────────────────

    public Order getOrder(UUID orderId) {
        return orderRepository.findById(orderId)
                .orElseThrow(() -> new EntityNotFoundException("Order not found: " + orderId));
    }

    public List<Order> getOrdersByCustomer(UUID customerId) {
        return orderRepository.findByCustomerId(customerId);
    }

    // ─── Status transition ────────────────────────────────────────────────────

    @Transactional
    public Order updateStatus(UUID orderId, OrderStatus newStatus) {
        Order order = getOrder(orderId);

        if (!OrderStatus.isValidTransition(order.getStatus(), newStatus)) {
            throw new IllegalStateException(
                    "Invalid status transition: %s → %s".formatted(order.getStatus(), newStatus));
        }

        order.setStatus(newStatus);
        Order saved = orderRepository.save(order);

        publishEvent("order." + newStatus.name().toLowerCase(), saved);
        log.info("Order {} status changed to {}", orderId, newStatus);
        return saved;
    }

    // ─── Cancel & refund ──────────────────────────────────────────────────────

    @Transactional
    public Order cancelOrder(UUID orderId) throws StripeException {
        Order order = updateStatus(orderId, OrderStatus.CANCELLED);

        if (order.getStripePaymentIntentId() != null) {
            RefundCreateParams refundParams = RefundCreateParams.builder()
                    .setPaymentIntent(order.getStripePaymentIntentId())
                    .build();
            Refund refund = Refund.create(refundParams);
            log.info("Stripe refund {} created for order {}", refund.getId(), orderId);

            order = updateStatus(orderId, OrderStatus.REFUNDED);
        }

        return order;
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    private void publishEvent(String routingKey, Order order) {
        try {
            rabbitTemplate.convertAndSend(EXCHANGE, routingKey, order);
        } catch (Exception e) {
            // Log and continue — events are best-effort; use dead-letter queues for reliability
            log.error("Failed to publish event '{}' for order {}: {}", routingKey, order.getId(), e.getMessage());
        }
    }

    // ─── Repository (inner interface for simplicity) ──────────────────────────

    @Repository
    public interface OrderRepository extends JpaRepository<Order, UUID> {
        List<Order> findByCustomerId(UUID customerId);
    }
}
