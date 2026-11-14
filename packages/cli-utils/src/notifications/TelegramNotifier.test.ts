import type { ILogger } from "@gearbox-protocol/sdk/onchain";
import { md } from "@vlad-yakovlev/telegram-md";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CensoredString } from "../CensoredString.js";
import { TelegramNotifier } from "./TelegramNotifier.js";
import type { IDedupableNotification, ThrottleFn } from "./types.js";

let mockFetch: ReturnType<typeof vi.fn<typeof fetch>>;
let notifier: TelegramNotifier;
const customThrottleFn: ThrottleFn = () => 1000; // 1 second wait time

beforeEach(() => {
  vi.useRealTimers();
  mockFetch = vi.fn<typeof fetch>();
  mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  notifier = createNotifier();
});

function createNotifier(logger?: ILogger): TelegramNotifier {
  return new TelegramNotifier(
    {
      type: "telegram",
      token: new CensoredString("test-token"),
      alertsChannel: new CensoredString("alerts"),
      notificationsChannel: new CensoredString("notifications"),
      prefix: "ALERT",
      retryInterval: 10,
      maxChunkSize: 20,
      fetchFn: mockFetch as typeof fetch,
    },
    logger,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

// basic test
it("should alert to telegram", async () => {
  notifier.notify({ plain: "it happened" }, "alert");
  await vi.waitFor(() => {
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("api.telegram.org"),
      expect.objectContaining({
        body: JSON.stringify({
          text: "ALERT it happened",
          chat_id: "alerts",
        }),
      }),
    );
  });
});

// call "notify" method. send message with plain and markdown. set chunk size so that after adding prefix to markdown we will have to slice message into chunks
it("should split long markdown message into plaintext chunks", async () => {
  // maxChunkSize is 20, prefix is "ALERT " (6 chars), so available space is 14
  // Message should be split into exactly 2 chunks (14 + 6 = 20 chars per chunk)
  const longPlainText = "This is a long message";
  const longMarkdown = md`This is a ${md.bold("long")} message`;

  const message: IDedupableNotification = {
    md: longMarkdown,
    plain: longPlainText,
  };

  notifier.notify(message, "notification");

  await vi.waitFor(() => {
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("api.telegram.org"),
      expect.objectContaining({
        body: JSON.stringify({
          text: "ALERT This is a long",
          chat_id: "notifications",
        }),
      }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("api.telegram.org"),
      expect.objectContaining({
        body: JSON.stringify({
          text: "ALERT  message",
          chat_id: "notifications",
        }),
      }),
    );
  });
});

// call "notify" method.simulate situation when we need to retry fetch call
it("should retry telegram api errors", async () => {
  let callCount = 0;

  mockFetch.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve(
        new Response("Internal Server Error", { status: 500 }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
  });

  notifier.notify({ plain: "Test message" }, "notification");

  await vi.waitFor(() => {
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

it("should abort and log a send that exceeds the queue timeout", async () => {
  const logger: ILogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  let signal: AbortSignal | null | undefined;
  // never answers; settles only when aborted, like a stalled connection
  mockFetch.mockImplementation((_url, init) => {
    signal = init?.signal;
    return new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal?.reason));
    });
  });

  createNotifier(logger).notify({ plain: "it happened" }, "alert");

  // retryInterval 10 * default retryCount 5 * 2
  await vi.waitFor(() => {
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("timed out after 100ms"),
    );
  });
  expect(signal?.aborted).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(logger.error).toHaveBeenCalledTimes(1);
});

describe("deduplication with throttle manager", () => {
  it("should block second message with same dedupeKey", async () => {
    vi.useFakeTimers();

    const message1: IDedupableNotification = {
      plain: "First message",
      dedupeKey: "test-key",
      throttleFn: customThrottleFn,
    };
    const message2: IDedupableNotification = {
      plain: "Second message",
      dedupeKey: "test-key",
      throttleFn: customThrottleFn,
    };

    notifier.notify(message1, "alert");
    notifier.notify(message2, "alert"); // Should be blocked

    await vi.advanceTimersByTimeAsync(100);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("api.telegram.org"),
      expect.objectContaining({
        body: JSON.stringify({
          text: "ALERT First message",
          chat_id: "alerts",
        }),
      }),
    );
  });

  it("should allow messages with different dedupeKeys", async () => {
    vi.useFakeTimers();

    const message1: IDedupableNotification = {
      plain: "Message 1",
      dedupeKey: "key1",
      throttleFn: customThrottleFn,
    };
    const message2: IDedupableNotification = {
      plain: "Message 2",
      dedupeKey: "key2",
      throttleFn: customThrottleFn,
    };

    notifier.notify(message1, "alert");
    notifier.notify(message2, "alert"); // Should be allowed (different key)

    await vi.advanceTimersByTimeAsync(100);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("api.telegram.org"),
      expect.objectContaining({
        body: JSON.stringify({
          text: "ALERT Message 1",
          chat_id: "alerts",
        }),
      }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("api.telegram.org"),
      expect.objectContaining({
        body: JSON.stringify({
          text: "ALERT Message 2",
          chat_id: "alerts",
        }),
      }),
    );
  });

  it("should not throttle messages without dedupeKey", async () => {
    vi.useFakeTimers();

    const message1: IDedupableNotification = {
      plain: "Message 1",
      throttleFn: customThrottleFn, // throttleFn is ignored without dedupeKey
    };
    const message2: IDedupableNotification = {
      plain: "Message 2",
      throttleFn: customThrottleFn, // throttleFn is ignored without dedupeKey
    };

    notifier.notify(message1, "alert");
    notifier.notify(message2, "alert"); // Should be allowed (no dedupeKey)

    await vi.advanceTimersByTimeAsync(100);

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("api.telegram.org"),
        expect.objectContaining({
          body: JSON.stringify({
            text: "ALERT Message 1",
            chat_id: "alerts",
          }),
        }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("api.telegram.org"),
        expect.objectContaining({
          body: JSON.stringify({
            text: "ALERT Message 2",
            chat_id: "alerts",
          }),
        }),
      );
    });
  });

  it("should allow message after throttle period expires", async () => {
    vi.useFakeTimers();

    const message1: IDedupableNotification = {
      plain: "Message 1",
      dedupeKey: "test-key",
      throttleFn: customThrottleFn,
    };
    const message2: IDedupableNotification = {
      plain: "Message 2",
      dedupeKey: "test-key",
      throttleFn: customThrottleFn,
    };

    // Send first message
    notifier.notify(message1, "alert");
    await vi.advanceTimersByTimeAsync(100); // Allow first message to be processed
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Try to send second message immediately - should be blocked
    notifier.notify(message2, "alert");
    await vi.advanceTimersByTimeAsync(100);
    expect(mockFetch).toHaveBeenCalledTimes(1); // Still only 1 call

    // Advance time past the throttle period
    await vi.advanceTimersByTimeAsync(customThrottleFn(0) + 100);

    // Now send the second message again - should be allowed
    notifier.notify(message2, "alert");
    await vi.advanceTimersByTimeAsync(100);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("api.telegram.org"),
      expect.objectContaining({
        body: JSON.stringify({
          text: "ALERT Message 2",
          chat_id: "alerts",
        }),
      }),
    );
  });
});
