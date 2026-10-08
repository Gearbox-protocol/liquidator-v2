import { describe, expect, it } from "vitest";
import { formatPrometheus } from "./formatPrometheus.js";

describe("formatPrometheus", () => {
  it("formats gauges with common and sample labels", () => {
    const text = formatPrometheus(
      [
        {
          name: "service_up",
          help: "Simple binary flag to indicate being alive",
          samples: [{ value: 1 }],
        },
        {
          name: "block_number",
          help: "Latest processed block",
          samples: [
            { labels: { network: "mainnet" }, value: 100n },
            { labels: { network: "arbitrum" }, value: 200n },
          ],
        },
      ],
      { instance_id: "abcd1234", version: "1.0.0" },
    );
    expect(text).toBe(
      `# HELP service_up Simple binary flag to indicate being alive
# TYPE service_up gauge
service_up{instance_id="abcd1234", version="1.0.0"} 1

# HELP block_number Latest processed block
# TYPE block_number gauge
block_number{instance_id="abcd1234", version="1.0.0", network="mainnet"} 100
block_number{instance_id="abcd1234", version="1.0.0", network="arbitrum"} 200
`,
    );
  });

  it("omits braces when there are no labels", () => {
    expect(
      formatPrometheus([
        { name: "start_time", help: "t", samples: [{ value: 5 }] },
      ]),
    ).toBe("# HELP start_time t\n# TYPE start_time gauge\nstart_time 5\n");
  });

  it("skips gauges without samples", () => {
    expect(
      formatPrometheus([{ name: "block_number", help: "b", samples: [] }]),
    ).toBe("");
  });

  it("escapes label values", () => {
    expect(
      formatPrometheus([
        {
          name: "g",
          help: "h",
          samples: [{ labels: { v: 'a"b\\c\nd' }, value: 0 }],
        },
      ]),
    ).toContain('g{v="a\\"b\\\\c\\nd"} 0');
  });
});
