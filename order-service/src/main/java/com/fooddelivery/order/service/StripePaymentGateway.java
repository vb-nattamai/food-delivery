package com.fooddelivery.order.service;

import com.stripe.Stripe;
import com.stripe.exception.StripeException;
import com.stripe.model.PaymentIntent;
import com.stripe.model.Refund;
import com.stripe.param.PaymentIntentCreateParams;
import com.stripe.param.RefundCreateParams;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;

/**
 * Live Stripe implementation of {@link PaymentGateway}.
 * Initialises the Stripe SDK with the configured API key on startup.
 */
@Component
public class StripePaymentGateway implements PaymentGateway {

    @Value("${stripe.api-key}")
    private String stripeApiKey;

    @PostConstruct
    void initStripe() {
        Stripe.apiKey = stripeApiKey;
    }

    @Override
    public String createPaymentIntent(BigDecimal amount, String currency, String customerId) throws StripeException {
        long amountCents = amount.multiply(BigDecimal.valueOf(100)).longValueExact();
        PaymentIntentCreateParams params = PaymentIntentCreateParams.builder()
                .setAmount(amountCents)
                .setCurrency(currency)
                .setCaptureMethod(PaymentIntentCreateParams.CaptureMethod.MANUAL)
                .putMetadata("customerId", customerId)
                .build();
        return PaymentIntent.create(params).getId();
    }

    @Override
    public String createRefund(String paymentIntentId) throws StripeException {
        RefundCreateParams params = RefundCreateParams.builder()
                .setPaymentIntent(paymentIntentId)
                .build();
        return Refund.create(params).getId();
    }
}
