import { type Markdown, md } from "@vlad-yakovlev/telegram-md";

function joinCallsPlain(calls?: string[]): string {
  return calls ? calls.map(c => ` ➤ ${c}`).join("\n") : "-";
}

function joinCallsMd(calls?: string[]): Markdown {
  return calls
    ? md.join(
        calls.map(c => ` ➤ ${c}`),
        "\n",
      )
    : // prettier-ignore
      md`-`;
}

const joinCalls = {
  plain: joinCallsPlain,
  md: joinCallsMd,
};

export default joinCalls;
