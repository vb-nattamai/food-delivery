package com.fooddelivery.order.service;

import com.fooddelivery.order.model.Order;
import com.fooddelivery.order.model.OrderStatus;
import com.stripe.exception.StripeException;
import jakarta.persistence.EntityNotFoundException;
import jakarta.transaction.Transactional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

@Service
public class OrderService {

    private static final Logger log = LoggerFactory.getLogger(OrderService.class);
    private static final String EXCHANGE = "order.events";

    private final OrderRepository orderRepository;
    private final RabbitTemplate rabbitTemplate;
    private final PaymentGateway paymentGateway;

    public OrderService(OrderRepository orderRepository,
                        RabbitTemplate rabbitTemplate,
                        PaymentGateway paymentGateway) {
        this.orderRepository = orderRepository;
        this.rabbitTemplate = rabbitTemplate;
        this.paymentGateway = paymentGateway;
    }

    // ─── Create order ─────────────────────────────────────────────────────────

    @Transactional
    public Order createOrder(Order order) throws StripeException {
        order.setStatus(OrderStatus.PENDING);

        String intentId = paymentGateway.createPaymentIntent(
                order.getTotalAmount(), "usd", order.getCustomerId().toString());
        order.setStripePaymentIntentId(intentId);

        Order saved = orderRepository.save(order);
        publishEvent("order.created", saved);
        log.info("Order created: {} with PaymentIntent: {}", saved.getId(), intentId);
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
            String refundId = paymentGateway.createRefund(order.getStripePaymentIntentId());
            log.info("Stripe refund {} created for order {}", refundId, orderId);
            order = updateStatus(orderId, OrderStatus.REFUNDED);
        }

        return order;
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    private void publishEvent(String routingKey, Order order) {
        try {
            rabbitTemplate.convertAndSend(EXCHANGE, routingKey, order);
        } catch (Exception e) {
            log.error("Failed to publish event '{}' for order {}: {}", routingKey, order.getId(), e.getMessage());
        }
    }

}
