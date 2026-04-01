package com.fooddelivery.order.model;

/**
 * Lifecycle states of an order.
 *
 * <pre>
 * PENDING → ACCEPTED → PREPARING → READY_FOR_PICKUP → IN_TRANSIT → DELIVERED
 *                                                                 ↓
 *                                                  CANCELLED / REFUNDED
 * </pre>
 */
public enum OrderStatus {

    /** Order placed, awaiting restaurant confirmation. */
    PENDING,

    /** Restaurant confirmed the order. */
    ACCEPTED,

    /** Kitchen is preparing the order. */
    PREPARING,

    /** Order is packaged and ready for driver pickup. */
    READY_FOR_PICKUP,

    /** Driver has collected the order and is en route. */
    IN_TRANSIT,

    /** Order successfully delivered to the customer. */
    DELIVERED,

    /** Order cancelled before delivery. */
    CANCELLED,

    /** Payment refunded following cancellation or dispute. */
    REFUNDED;

    /**
     * Returns {@code true} when transitioning from {@code current} to {@code next}
     * is a valid forward step in the order lifecycle.
     */
    public static boolean isValidTransition(OrderStatus current, OrderStatus next) {
        return switch (current) {
            case PENDING          -> next == ACCEPTED   || next == CANCELLED;
            case ACCEPTED         -> next == PREPARING  || next == CANCELLED;
            case PREPARING        -> next == READY_FOR_PICKUP || next == CANCELLED;
            case READY_FOR_PICKUP -> next == IN_TRANSIT || next == CANCELLED;
            case IN_TRANSIT       -> next == DELIVERED  || next == CANCELLED;
            case DELIVERED        -> next == REFUNDED;
            case CANCELLED        -> next == REFUNDED;
            case REFUNDED         -> false;
        };
    }
}
