/** Status-to-emoji mapping for Telegram task messages */
const STATUS_EMOJIS: Record<string, string> = {
  open: '\u{1F4C2}',              // 📂
  planning: '\u{1F4CB}',          // 📋
  plan_review: '\u{1F4DD}',       // 📝
  designing: '\u{1F3A8}',         // 🎨
  design_review: '\u{1F50D}',     // 🔍
  implementing: '\u{1F528}',      // 🔨
  pr_review: '\u{1F50E}',        // 🔎
  ready_to_merge: '\u{1F500}',   // 🔀
  done: '\u{2705}',              // ✅
  investigating: '\u{1F50D}',     // 🔍
  investigation_review: '\u{1F4DD}', // 📝
  needs_info: '\u{2753}',        // ❓
  backlog: '\u{1F4E5}',          // 📥
  in_progress: '\u{1F528}',      // 🔨
  in_review: '\u{1F50E}',        // 🔎
  reported: '\u{1F4E2}',         // 📢
  fixing: '\u{1F527}',           // 🔧
};

/** Returns the emoji for a task status, or a default folder emoji for unknown statuses */
export function statusEmoji(status: string): string {
  return STATUS_EMOJIS[status] ?? '\u{1F4C4}'; // 📄 default
}
