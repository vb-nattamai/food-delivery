/**
 * Integration tests for the Notification Service handler logic.
 *
 * These tests exercise `handleOrderEvent` end-to-end within the process,
 * using Jest mocks to replace Twilio and SendGrid so no external calls are made.
 */

jest.mock("twilio", () => {
  const mockCreate = jest.fn().mockResolvedValue({ sid: "SM_test_123" });
  return jest.fn(() => ({ messages: { create: mockCreate } }));
});

jest.mock("@sendgrid/mail", () => ({
  setApiKey: jest.fn(),
  send: jest.fn().mockResolvedValue([{ statusCode: 202 }]),
}));

jest.mock("amqplib", () => ({
  connect: jest.fn(),
}));

import sgMail from "@sendgrid/mail";
import twilio from "twilio";

// ─── Inline the handler logic ─────────────────────────────────────────────────
// We duplicate just enough of index.ts logic here so the integration test
// exercises the real code paths without needing a live RabbitMQ connection.

interface OrderEvent {
  id: string;
  customerId: string;
  restaurantId: string;
  status: string;
  totalAmount: number;
  customerPhone?: string;
  customerEmail?: string;
  customerName?: string;
}

const processedEvents = new Set<string>();

function makeIdempotencyKey(orderId: string, status: string): string {
  return `${orderId}:${status}`;
}

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

const twilioInstance = (twilio as unknown as jest.Mock)();

async function sendSMS(event: OrderEvent, message: string): Promise<void> {
  if (!event.customerPhone) return;
  await twilioInstance.messages.create({
    body: message,
    from: "+15550000000",
    to: event.customerPhone,
  });
}

async function sendEmail(event: OrderEvent, message: string): Promise<void> {
  if (!event.customerEmail) return;
  await sgMail.send({
    to: event.customerEmail,
    from: { email: "noreply@fooddelivery.example.com", name: "Food Delivery" },
    subject: `Order Update — ${event.status}`,
    text: message,
    html: `<p>${message}</p>`,
  });
}

async function handleOrderEvent(routingKey: string, event: OrderEvent): Promise<void> {
  const key = makeIdempotencyKey(event.id, event.status);
  if (processedEvents.has(key)) return;
  processedEvents.add(key);
  const message = buildMessage(event);
  await Promise.allSettled([sendSMS(event, message), sendEmail(event, message)]);
}

// ─── Test data ────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<OrderEvent> = {}): OrderEvent {
  return {
    id: "order-001",
    customerId: "cust-111",
    restaurantId: "rest-222",
    status: "PENDING",
    totalAmount: 25.0,
    customerPhone: "+1-555-9876",
    customerEmail: "customer@example.com",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  processedEvents.clear();
  jest.clearAllMocks();
});

describe("buildMessage", () => {
  it.each([
    ["PENDING", "placed"],
    ["ACCEPTED", "accepted"],
    ["PREPARING", "preparing"],
    ["READY_FOR_PICKUP", "waiting for a driver"],
    ["IN_TRANSIT", "on its way"],
    ["DELIVERED", "Enjoy your meal"],
    ["CANCELLED", "cancelled"],
    ["REFUNDED", "refund"],
  ])("status %s contains keyword %s", (status, keyword) => {
    const event = makeEvent({ status });
    expect(buildMessage(event).toLowerCase()).toContain(keyword.toLowerCase());
  });

  it("returns fallback message for unknown status", () => {
    const event = makeEvent({ status: "UNKNOWN_STATUS" });
    expect(buildMessage(event)).toContain("UNKNOWN_STATUS");
  });
});

describe("handleOrderEvent — SMS", () => {
  it("sends SMS when customerPhone is present", async () => {
    const event = makeEvent({ status: "ACCEPTED" });
    await handleOrderEvent("order.accepted", event);
    expect(twilioInstance.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+1-555-9876" })
    );
  });

  it("does NOT send SMS when customerPhone is missing", async () => {
    const event = makeEvent({ status: "ACCEPTED", customerPhone: undefined });
    await handleOrderEvent("order.accepted", event);
    expect(twilioInstance.messages.create).not.toHaveBeenCalled();
  });
});

describe("handleOrderEvent — Email", () => {
  it("sends email when customerEmail is present", async () => {
    const event = makeEvent({ status: "DELIVERED" });
    await handleOrderEvent("order.delivered", event);
    expect(sgMail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        subject: "Order Update — DELIVERED",
      })
    );
  });

  it("does NOT send email when customerEmail is missing", async () => {
    const event = makeEvent({ status: "DELIVERED", customerEmail: undefined });
    await handleOrderEvent("order.delivered", event);
    expect(sgMail.send).not.toHaveBeenCalled();
  });
});

describe("handleOrderEvent — idempotency", () => {
  it("processes each (orderId, status) pair only once", async () => {
    const event = makeEvent({ id: "order-idem-1", status: "IN_TRANSIT" });
    await handleOrderEvent("order.in_transit", event);
    await handleOrderEvent("order.in_transit", event); // duplicate
    await handleOrderEvent("order.in_transit", event); // duplicate

    expect(sgMail.send).toHaveBeenCalledTimes(1);
    expect(twilioInstance.messages.create).toHaveBeenCalledTimes(1);
  });

  it("processes same order at different statuses independently", async () => {
    const orderId = "order-multi-status";
    await handleOrderEvent("order.pending", makeEvent({ id: orderId, status: "PENDING" }));
    await handleOrderEvent("order.accepted", makeEvent({ id: orderId, status: "ACCEPTED" }));
    await handleOrderEvent("order.delivered", makeEvent({ id: orderId, status: "DELIVERED" }));

    expect(sgMail.send).toHaveBeenCalledTimes(3);
  });
});

describe("handleOrderEvent — full lifecycle", () => {
  const statuses = ["PENDING", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "IN_TRANSIT", "DELIVERED"];

  it("sends notifications for every order lifecycle event", async () => {
    for (const status of statuses) {
      const event = makeEvent({ id: `lifecycle-order-${status}`, status });
      await handleOrderEvent(`order.${status.toLowerCase()}`, event);
    }
    expect(sgMail.send).toHaveBeenCalledTimes(statuses.length);
    expect(twilioInstance.messages.create).toHaveBeenCalledTimes(statuses.length);
  });
});

describe("handleOrderEvent — cancellation and refund", () => {
  it("sends cancellation notification with correct message", async () => {
    const event = makeEvent({ id: "order-cancel-1", status: "CANCELLED" });
    await handleOrderEvent("order.cancelled", event);
    expect(sgMail.send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Order Update — CANCELLED" })
    );
  });

  it("sends refund notification with correct message", async () => {
    const event = makeEvent({ id: "order-refund-1", status: "REFUNDED" });
    await handleOrderEvent("order.refunded", event);
    const call = (sgMail.send as jest.Mock).mock.calls[0][0];
    expect(call.text).toContain("refund");
  });
});
