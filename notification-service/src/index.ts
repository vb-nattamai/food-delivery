/**
 * Notification Service
 *
 * Consumes order.* events from RabbitMQ and delivers notifications via:
 *   - Twilio SMS  (customer phone)
 *   - SendGrid email (customer email)
 *
 * Idempotency: a processed Set (in-process, swap for Redis in production)
 * guards against duplicate message delivery on re-queue.
 */

import * as amqp from "amqplib";
import sgMail from "@sendgrid/mail";
import twilio from "twilio";
import "dotenv/config";

// ─── Config ───────────────────────────────────────────────────────────────────

const RABBITMQ_URL =
  process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672/";
const EXCHANGE = "order.events";
const QUEUE = "notification-service.order-events";
const BINDING_PATTERN = "order.*";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER ?? "";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY ?? "";
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL ?? "noreply@fooddelivery.example.com";
const SENDGRID_FROM_NAME = process.env.SENDGRID_FROM_NAME ?? "Food Delivery";

// ─── Clients ──────────────────────────────────────────────────────────────────

sgMail.setApiKey(SENDGRID_API_KEY);
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderEvent {
  id: string;
  customerId: string;
  restaurantId: string;
  status: string;
  totalAmount: number;
  /** Optional — populated by customer profile service in a full system */
  customerPhone?: string;
  customerEmail?: string;
  customerName?: string;
}

// ─── Idempotency ─────────────────────────────────────────────────────────────

/**
 * Tracks (orderId, status) pairs that have already been processed.
 * In production, replace with a Redis SET with a TTL.
 */
const processedEvents = new Set<string>();

function makeIdempotencyKey(orderId: string, status: string): string {
  return `${orderId}:${status}`;
}

// ─── Notification logic ───────────────────────────────────────────────────────

function buildMessage(event: OrderEvent): string {
  const statusMessages: Record<string, string> = {
    PENDING: "Your order has been placed and is awaiting confirmation.",
    ACCEPTED: "Great news! The restaurant has accepted your order.",
    PREPARING: "The kitchen is preparing your order.",
    READY_FOR_PICKUP: "Your order is ready and waiting for a driver.",
    IN_TRANSIT: "Your order is on its way!",
    DELIVERED: "Your order has been delivered. Enjoy your meal!",
    CANCELLED: "Your order has been cancelled.",
    REFUNDED: "Your refund has been initiated. It may take 3-5 business days.",
  };
  return statusMessages[event.status] ?? `Order status updated to: ${event.status}`;
}

async function sendSMS(event: OrderEvent, message: string): Promise<void> {
  if (!event.customerPhone) return;
  try {
    await twilioClient.messages.create({
      body: message,
      from: TWILIO_FROM_NUMBER,
      to: event.customerPhone,
    });
    console.log(`[SMS] Sent to ${event.customerPhone} for order ${event.id}`);
  } catch (err) {
    console.error(`[SMS] Failed for order ${event.id}:`, err);
  }
}

async function sendEmail(event: OrderEvent, message: string): Promise<void> {
  if (!event.customerEmail) return;
  try {
    await sgMail.send({
      to: event.customerEmail,
      from: { email: SENDGRID_FROM_EMAIL, name: SENDGRID_FROM_NAME },
      subject: `Order Update — ${event.status}`,
      text: message,
      html: `<p>${message}</p><p>Order ID: <strong>${event.id}</strong></p>`,
    });
    console.log(`[Email] Sent to ${event.customerEmail} for order ${event.id}`);
  } catch (err) {
    console.error(`[Email] Failed for order ${event.id}:`, err);
  }
}

async function handleOrderEvent(
  routingKey: string,
  event: OrderEvent
): Promise<void> {
  const key = makeIdempotencyKey(event.id, event.status);

  if (processedEvents.has(key)) {
    console.log(`[Dedup] Skipping already-processed event: ${key}`);
    return;
  }

  processedEvents.add(key);

  const message = buildMessage(event);
  console.log(`[Event] ${routingKey} | order=${event.id} status=${event.status}`);

  await Promise.allSettled([sendSMS(event, message), sendEmail(event, message)]);
}

// ─── RabbitMQ consumer ────────────────────────────────────────────────────────

async function startConsumer(): Promise<void> {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE, "topic", { durable: true });
  const { queue } = await channel.assertQueue(QUEUE, { durable: true });
  await channel.bindQueue(queue, EXCHANGE, BINDING_PATTERN);

  channel.prefetch(10);

  console.log(`[RabbitMQ] Listening on exchange="${EXCHANGE}" pattern="${BINDING_PATTERN}"`);

  channel.consume(queue, async (msg) => {
    if (!msg) return;

    try {
      const event: OrderEvent = JSON.parse(msg.content.toString());
      await handleOrderEvent(msg.fields.routingKey, event);
      channel.ack(msg);
    } catch (err) {
      console.error("[Consumer] Failed to process message:", err);
      // Nack without requeue to avoid poison-message loops; use DLX in production
      channel.nack(msg, false, false);
    }
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[Shutdown] Received ${signal}, closing…`);
    await channel.close();
    await connection.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// ─── Entry point ──────────────────────────────────────────────────────────────

startConsumer().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
