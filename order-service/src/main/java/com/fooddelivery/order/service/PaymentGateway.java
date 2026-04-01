package com.fooddelivery.order.service;

import com.stripe.exception.StripeException;

import java.math.BigDecimal;

/**
 * Abstracts Stripe payment operations behind an interface so tests can
 * inject a mock without needing PowerMock or a live Stripe connection.
 */
public interface PaymentGateway {

    /**
     * Creates a Stripe PaymentIntent with MANUAL capture for the given amount.
     *
     * @return the Stripe PaymentIntent ID (pi_xxx)
     */
    String createPaymentIntent(BigDecimal amount, String currency, String customerId) throws StripeException;

    /**
     * Issues a full refund against the given PaymentIntent.
     *
     * @return the Stripe Refund ID (re_xxx)
     */
    String createRefund(String paymentIntentId) throws StripeException;
}
