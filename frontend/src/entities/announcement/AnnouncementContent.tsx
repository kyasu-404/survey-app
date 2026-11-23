import type { ReactNode } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import "./announcementContent.css";

const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function safeAnnouncementUrl(value?: string | null) {
  if (!value || value.length > 2048 || /[\s\\]/u.test(value) || Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  try {
    if (value.startsWith("/") && !value.startsWith("//")) {
      const path = new URL(value, "https://app.invalid");
      const normalized = path.pathname + path.search + path.hash;
      return normalized.startsWith("//") || normalized.length > 2048 ? null : normalized;
    }
    if (!/^https?:\/\/[^/]/i.test(value)) return null;
    const url = new URL(value);
    const host = url.hostname;
    const validHost = host.startsWith("[") || host.replace(/\.$/, "").split(".").every(label => dnsLabel.test(label));
    return validHost && url.port !== "0" && !url.username && !url.password && url.href.length <= 2048 ? url.href : null;
  } catch {
    return null;
  }
}

function inlineText(text: string) {
  return text.split(/(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, index) => {
    if (index % 2 === 0) return part;
    if (part.startsWith("***")) return <strong key={index}><em>{part.slice(3, -3)}</em></strong>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function messageBlocks(message: string) {
  const blocks: ReactNode[] = [];
  let lines: string[] = [];
  let list = false;
  const flush = () => {
    if (!lines.length) return;
    const key = blocks.length;
    blocks.push(list
      ? <ul key={key}>{lines.map((line, index) => <li key={index}>{inlineText(line)}</li>)}</ul>
      : <p key={key}>{inlineText(lines.join("\n"))}</p>);
    lines = [];
  };
  for (const line of message.split(/\r?\n/)) {
    if (!line.trim()) { flush(); continue; }
    const bullet = /^\s*[-*]\s+/.exec(line);
    if (Boolean(bullet) !== list) flush();
    list = Boolean(bullet);
    lines.push(bullet ? line.slice(bullet[0].length) : line);
  }
  flush();
  return blocks;
}

type Props = { message: string; actionLabel?: string | null; actionUrl?: string | null; onAction?: () => void; preview?: boolean };

export function AnnouncementContent({ message, actionLabel, actionUrl, onAction, preview }: Props) {
  const inApp = useInRouterContext();
  const href = safeAnnouncementUrl(actionUrl);
  const caption = actionLabel?.trim() || "Подробнее";
  return <div className="announcement-content">
    {messageBlocks(message)}
    {href && (preview ? <span className="announcement-action">{caption}</span> : href.startsWith("/") && inApp
      ? <Link className="announcement-action" to={href} onClick={onAction}>{caption}</Link>
      : <a className="announcement-action" href={href} onClick={onAction}
      target={href.startsWith("/") ? undefined : "_blank"} rel={href.startsWith("/") ? undefined : "noopener noreferrer"}>
      {caption}
    </a>)}
  </div>;
}
