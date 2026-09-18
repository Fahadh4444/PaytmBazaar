import { Fragment, type ReactNode } from "react";

/**
 * Renders the little formatting the assistant uses: **bold**, and lines
 * starting with "- " or "* " as a list. Everything else is plain text; React
 * escapes it, so no model output is ever treated as HTML.
 */
export function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export default function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={`l${blocks.length}`} style={{ margin: "4px 0", paddingLeft: 18 }}>
          {list.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flush();
    if (line) blocks.push(<p key={`p${blocks.length}`} style={{ margin: "4px 0" }}>{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}
