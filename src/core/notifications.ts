/**
 * Outbound owner notifications (takedown, appeal). The product has no email
 * provider wired yet, so the default notifier logs through a sink. Swapping in
 * a real provider is a one-line change at the call site; the domain never
 * depends on a vendor.
 */
export interface Notification {
  userId: string;
  kind: "takedown" | "appeal" | "ban" | string;
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface Notifier {
  send(notification: Notification): Promise<void>;
}

export interface NotificationSink {
  info(message: string, fields?: Record<string, unknown>): void;
}

export function createLoggingNotifier(sink: NotificationSink = console): Notifier {
  return {
    async send(notification) {
      sink.info(`[notify] ${notification.kind}: ${notification.subject}`, {
        userId: notification.userId,
        ...notification.metadata,
      });
    },
  };
}

let notifier: Notifier | undefined;

/** Memoized default. Tests inject their own notifier instead. */
export function getDefaultNotifier(): Notifier {
  notifier ??= createLoggingNotifier();
  return notifier;
}
