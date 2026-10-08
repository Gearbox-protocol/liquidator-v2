/**
 * Prometheus label names mapped to label values.
 */
export type PrometheusLabels = Record<string, string>;

/**
 * Single sample of a {@link PrometheusGauge}.
 */
export interface PrometheusSample {
  /**
   * Labels of this sample, appended after the common labels
   */
  labels?: PrometheusLabels;
  /**
   * Sample value
   */
  value: number | bigint;
}

/**
 * Prometheus gauge metric.
 */
export interface PrometheusGauge {
  /**
   * Metric name, e.g. `block_number`
   */
  name: string;
  /**
   * Human-readable description, emitted as `# HELP`
   */
  help: string;
  /**
   * Samples of the gauge. A gauge without samples is not emitted.
   */
  samples: PrometheusSample[];
}

/**
 * Serializes gauges in the Prometheus text exposition format.
 *
 * See https://prometheus.io/docs/instrumenting/exposition_formats/
 *
 * @param gauges - Gauges to serialize
 * @param commonLabels - Labels added to every sample, before the sample's own labels
 * @returns Text with one `# HELP` / `# TYPE` block per gauge
 */
export function formatPrometheus(
  gauges: PrometheusGauge[],
  commonLabels: PrometheusLabels = {},
): string {
  const blocks: string[] = [];
  for (const { name, help, samples } of gauges) {
    if (samples.length === 0) {
      continue;
    }
    const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`];
    for (const { labels, value } of samples) {
      const formatted = formatLabels({ ...commonLabels, ...labels });
      lines.push(`${name}${formatted} ${value}`);
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.length ? `${blocks.join("\n\n")}\n` : "";
}

function formatLabels(labels: PrometheusLabels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return "";
  }
  const inner = entries
    .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
    .join(", ");
  return `{${inner}}`;
}

function escapeLabelValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n");
}
