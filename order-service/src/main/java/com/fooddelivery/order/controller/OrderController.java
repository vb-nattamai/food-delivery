package com.fooddelivery.order.controller;

import com.fooddelivery.order.model.Order;
import com.fooddelivery.order.model.OrderStatus;
import com.fooddelivery.order.service.OrderService;
import com.stripe.exception.StripeException;
import jakarta.persistence.EntityNotFoundException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/orders")
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    // ─── Create order ─────────────────────────────────────────────────────────

    @PostMapping
    public ResponseEntity<Order> createOrder(
            @RequestHeader("X-Customer-Id") UUID customerId,
            @Valid @RequestBody Order order) {
        order.setCustomerId(customerId);
        try {
            Order created = orderService.createOrder(order);
            return ResponseEntity.status(HttpStatus.CREATED).body(created);
        } catch (StripeException e) {
            throw new ResponseStatusException(HttpStatus.PAYMENT_REQUIRED, e.getMessage());
        }
    }

    // ─── List orders for customer ─────────────────────────────────────────────

    @GetMapping
    public ResponseEntity<List<Order>> listOrders(
            @RequestHeader("X-Customer-Id") UUID customerId) {
        return ResponseEntity.ok(orderService.getOrdersByCustomer(customerId));
    }

    // ─── Get single order ─────────────────────────────────────────────────────

    @GetMapping("/{orderId}")
    public ResponseEntity<Order> getOrder(@PathVariable UUID orderId) {
        try {
            return ResponseEntity.ok(orderService.getOrder(orderId));
        } catch (EntityNotFoundException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, e.getMessage());
        }
    }

    // ─── Update status ────────────────────────────────────────────────────────

    @PatchMapping("/{orderId}/status")
    public ResponseEntity<Order> updateStatus(
            @PathVariable UUID orderId,
            @Valid @RequestBody StatusUpdateRequest request) {
        try {
            return ResponseEntity.ok(orderService.updateStatus(orderId, request.status()));
        } catch (EntityNotFoundException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, e.getMessage());
        } catch (IllegalStateException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, e.getMessage());
        }
    }

    // ─── Cancel order ─────────────────────────────────────────────────────────

    @PostMapping("/{orderId}/cancel")
    public ResponseEntity<Order> cancelOrder(@PathVariable UUID orderId) {
        try {
            return ResponseEntity.ok(orderService.cancelOrder(orderId));
        } catch (EntityNotFoundException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, e.getMessage());
        } catch (IllegalStateException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, e.getMessage());
        } catch (StripeException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Stripe error: " + e.getMessage());
        }
    }

    // ─── Request record ───────────────────────────────────────────────────────

    public record StatusUpdateRequest(@NotNull OrderStatus status) {}
}
