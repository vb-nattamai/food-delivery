package com.fooddelivery.order.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fooddelivery.order.controller.OrderController;
import com.fooddelivery.order.model.Order;
import com.fooddelivery.order.model.OrderStatus;
import com.fooddelivery.order.service.PaymentGateway;
import com.fooddelivery.order.service.OrderService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Full-stack integration tests for the Order Service.
 *
 * The Spring context is loaded with H2 in-memory database (via application-test.properties).
 * Stripe and RabbitMQ are replaced with Mockito mocks via @MockBean so no external
 * services are needed.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class OrderIntegrationTest {

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired OrderService orderService;

    @MockBean PaymentGateway paymentGateway;
    @MockBean RabbitTemplate rabbitTemplate;

    private static final UUID CUSTOMER_ID = UUID.randomUUID();
    private static final UUID RESTAURANT_ID = UUID.randomUUID();
    private static final String FAKE_INTENT_ID = "pi_test_integration_abc123";
    private static final String FAKE_REFUND_ID  = "re_test_integration_xyz789";

    @BeforeEach
    void setUp() throws Exception {
        when(paymentGateway.createPaymentIntent(any(BigDecimal.class), anyString(), anyString()))
                .thenReturn(FAKE_INTENT_ID);
        when(paymentGateway.createRefund(anyString()))
                .thenReturn(FAKE_REFUND_ID);
    }

    // ─── Helper ───────────────────────────────────────────────────────────────

    private Order.OrderItem item(String name, int qty, double price) {
        return new Order.OrderItem(UUID.randomUUID(), name, qty, BigDecimal.valueOf(price));
    }

    private String createOrderJson(BigDecimal total) throws Exception {
        Order req = new Order();
        req.setRestaurantId(RESTAURANT_ID);
        req.setDeliveryAddress("123 Test St");
        req.setTotalAmount(total);
        req.setItems(List.of(item("Pizza", 2, total.doubleValue() / 2)));
        return objectMapper.writeValueAsString(req);
    }

    private UUID createOrder() throws Exception {
        MvcResult result = mockMvc.perform(post("/orders")
                        .header("X-Customer-Id", CUSTOMER_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createOrderJson(BigDecimal.valueOf(29.98))))
                .andExpect(status().isCreated())
                .andReturn();
        Order created = objectMapper.readValue(result.getResponse().getContentAsString(), Order.class);
        return created.getId();
    }

    // ─── Create order ─────────────────────────────────────────────────────────

    @Test
    void createOrder_returns201_withPendingStatus_andStripeIntentId() throws Exception {
        mockMvc.perform(post("/orders")
                        .header("X-Customer-Id", CUSTOMER_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createOrderJson(BigDecimal.valueOf(19.99))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.stripePaymentIntentId").value(FAKE_INTENT_ID))
                .andExpect(jsonPath("$.customerId").value(CUSTOMER_ID.toString()));

        verify(paymentGateway).createPaymentIntent(any(), eq("usd"), eq(CUSTOMER_ID.toString()));
        verify(rabbitTemplate).convertAndSend(eq("order.events"), eq("order.created"), any(Order.class));
    }

    @Test
    void createOrder_storesOrderInDatabase() throws Exception {
        UUID orderId = createOrder();
        Order found = orderService.getOrder(orderId);
        assertThat(found.getStatus()).isEqualTo(OrderStatus.PENDING);
        assertThat(found.getStripePaymentIntentId()).isEqualTo(FAKE_INTENT_ID);
    }

    // ─── List orders ──────────────────────────────────────────────────────────

    @Test
    void listOrders_returnsOnlyCustomerOrders() throws Exception {
        UUID orderId = createOrder();

        mockMvc.perform(get("/orders")
                        .header("X-Customer-Id", CUSTOMER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].id", hasItem(orderId.toString())))
                .andExpect(jsonPath("$[*].customerId", everyItem(is(CUSTOMER_ID.toString()))));
    }

    // ─── Get by ID ────────────────────────────────────────────────────────────

    @Test
    void getOrder_returns200_whenFound() throws Exception {
        UUID orderId = createOrder();

        mockMvc.perform(get("/orders/" + orderId)
                        .header("X-Customer-Id", CUSTOMER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(orderId.toString()));
    }

    @Test
    void getOrder_returns404_whenNotFound() throws Exception {
        mockMvc.perform(get("/orders/" + UUID.randomUUID())
                        .header("X-Customer-Id", CUSTOMER_ID))
                .andExpect(status().isNotFound());
    }

    // ─── Status transitions ───────────────────────────────────────────────────

    @Test
    void statusTransition_pendingToAccepted_succeeds() throws Exception {
        UUID orderId = createOrder();

        mockMvc.perform(patch("/orders/" + orderId + "/status")
                        .header("X-Customer-Id", CUSTOMER_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"ACCEPTED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACCEPTED"));

        verify(rabbitTemplate).convertAndSend(eq("order.events"), eq("order.accepted"), any(Order.class));
    }

    @Test
    void statusTransition_fullLifecycle_pendingToDelivered() throws Exception {
        UUID orderId = createOrder();
        OrderStatus[] lifecycle = {
            OrderStatus.ACCEPTED, OrderStatus.PREPARING,
            OrderStatus.READY_FOR_PICKUP, OrderStatus.IN_TRANSIT, OrderStatus.DELIVERED
        };
        for (OrderStatus next : lifecycle) {
            mockMvc.perform(patch("/orders/" + orderId + "/status")
                            .header("X-Customer-Id", CUSTOMER_ID)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"status\":\"" + next + "\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value(next.name()));
        }
    }

    @Test
    void statusTransition_invalidSkip_returns409() throws Exception {
        UUID orderId = createOrder(); // PENDING

        // Cannot jump PENDING → IN_TRANSIT
        mockMvc.perform(patch("/orders/" + orderId + "/status")
                        .header("X-Customer-Id", CUSTOMER_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"IN_TRANSIT\"}"))
                .andExpect(status().isConflict());
    }

    @Test
    void statusTransition_missingStatus_returns400() throws Exception {
        UUID orderId = createOrder();

        mockMvc.perform(patch("/orders/" + orderId + "/status")
                        .header("X-Customer-Id", CUSTOMER_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());
    }

    // ─── Cancel & refund ──────────────────────────────────────────────────────

    @Test
    void cancelOrder_transitions_to_cancelled_then_refunded() throws Exception {
        UUID orderId = createOrder(); // PENDING → has stripePaymentIntentId

        mockMvc.perform(post("/orders/" + orderId + "/cancel")
                        .header("X-Customer-Id", CUSTOMER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REFUNDED"));

        verify(paymentGateway).createRefund(FAKE_INTENT_ID);
        verify(rabbitTemplate).convertAndSend(eq("order.events"), eq("order.cancelled"), any(Order.class));
        verify(rabbitTemplate).convertAndSend(eq("order.events"), eq("order.refunded"), any(Order.class));
    }

    @Test
    void cancelOrder_alreadyDelivered_returns409() throws Exception {
        UUID orderId = createOrder();
        // Drive to DELIVERED
        for (OrderStatus s : new OrderStatus[]{
                OrderStatus.ACCEPTED, OrderStatus.PREPARING,
                OrderStatus.READY_FOR_PICKUP, OrderStatus.IN_TRANSIT, OrderStatus.DELIVERED}) {
            orderService.updateStatus(orderId, s);
        }

        mockMvc.perform(post("/orders/" + orderId + "/cancel")
                        .header("X-Customer-Id", CUSTOMER_ID))
                .andExpect(status().isConflict());
    }
}
