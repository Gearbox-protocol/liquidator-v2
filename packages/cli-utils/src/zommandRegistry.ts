import * as z4 from "zod/v4/core";

export const zommandRegistry = z4.registry<{
  flags: string;
  env?: string;
  description?: string;
}>();
