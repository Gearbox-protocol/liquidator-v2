import { readFile } from "node:fs/promises";
import { dirname, resolve as pathResolve } from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import YAML, { isPair, isScalar, isSeq } from "yaml";
import getPromisePath from "./getPromisePath.js";

export type TemplateData = Record<string, unknown>;

/**
 * Template key regexp
 * Consists of alphanumeric+underscore parts separated by dots, all wrappped in env-style brackets
 * e.g. ${KEY} or ${KEY.SUBKEY}
 *
 * Optionally supports a bash-style default value via `:-`, e.g. `${KEY:-fallback}`.
 * The default is used when the resolved value is undefined, null, or an empty string.
 * Capture groups: 1 = key path, 2 = optional default literal (no `}` allowed).
 */
const templateKeyRegex = /\$\{([\w-]+(?:\.[\w-]+)*)(?::-([^}]*))?\}/g;

/**
 * Replaces all `${...}` template tokens in a string using the provided template data.
 * Supports bash-style `${KEY:-default}` fallback when the resolved value is missing
 * (undefined, null, or empty string). The default is a literal and is not further
 * interpolated.
 */
async function resolveScalarValue(
  val: string,
  templateData?: TemplateData,
): Promise<string> {
  const matches = val.matchAll(templateKeyRegex);
  for (const match of matches) {
    const [whole, key, defaultValue] = match;
    const resolved = await getPromisePath(templateData, key);
    if (resolved !== undefined && resolved !== null && resolved !== "") {
      val = val.replace(whole, String(resolved));
    } else if (defaultValue !== undefined) {
      val = val.replace(whole, defaultValue);
    }
  }
  return val;
}

/**
 * Merges yaml files, respecting .extends references.
 * Performs env variable substitution on the config.
 * Respects YAML anchors and aliases, and merge keys - so that they can be shared across two files
 *
 * x-* anchors are removed from resulting document (a-la docker compose yaml)
 *
 * @param file
 * @param templateData
 * @returns
 */
export async function resolveYamlFiles(
  file: string,
  templateData?: TemplateData,
): Promise<object> {
  const doc = await resolveYamlDoc(file, templateData);
  const obj = doc.toJSON();
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !k.startsWith("x-")),
  );
}

/**
 * Merges yaml documents, respecting .extends references.
 * Optionally, performs env-style variable substitution on the config.
 * Respects YAML anchors and aliases, and merge keys - so that they can be shared across two files
 * Supports s3 links for file
 *
 * @param file
 * @param templateData
 * @returns
 */
export async function resolveYamlDoc(
  file: string,
  templateData?: TemplateData,
): Promise<YAML.Document> {
  const content = await loadFile(file);
  // if (templateData) {
  //   const compiled = template(content);
  //   content = compiled(templateData);
  // }
  let cfgRaw: YAML.Document = YAML.parseDocument(content, { merge: true });
  // let cfgRaw = YAML.parse(content, { merge: true });
  if (cfgRaw.has("extends")) {
    const baseFile = cfgRaw.get("extends") as string;
    const extended = cfgRaw;
    // extends is a relative path to the base file
    cfgRaw = await resolveYamlDoc(
      getRelativePath(file, baseFile),
      templateData,
    );
    YAML.visit(extended, {
      Pair(_, pair, rawPath) {
        const path = getNodesPath(rawPath);
        if (isScalar(pair.key) && (isScalar(pair.value) || isSeq(pair.value))) {
          if (pair.key.value === "extends") {
            return;
          }
          cfgRaw.setIn([...path, pair.key.value], pair.value);
          return YAML.visit.SKIP;
        }
      },
    });
  }

  await YAML.visitAsync(cfgRaw, {
    Scalar: async (_, node) => {
      if (typeof node.value === "string") {
        node.value = await resolveScalarValue(node.value, templateData);
      }
    },
  });

  return cfgRaw;
}

/**
 * Helper function that gets object with templated values
 * Just because async ast already exists in yaml, but not in json reviver
 * @param json
 * @param templateData
 * @returns
 */
export async function resolveFromObject(
  json: object,
  templateData?: TemplateData,
): Promise<object> {
  const content = YAML.stringify(json);
  const cfgRaw: YAML.Document = YAML.parseDocument(content, { merge: true });

  await YAML.visitAsync(cfgRaw, {
    Scalar: async (_, node) => {
      if (typeof node.value === "string") {
        node.value = await resolveScalarValue(node.value, templateData);
      }
    },
  });

  return cfgRaw.toJSON();
}

function getNodesPath(
  nodes: readonly (YAML.Node | YAML.Document | YAML.Pair)[],
): unknown[] {
  return nodes
    .map(n => {
      if (isPair(n) && isScalar(n.key)) {
        return n.key.value;
      }
      return "";
    })
    .filter(Boolean);
}

/**
 * Loads file from s3 or local file system
 * @param file - s3 link or local file path
 * @returns file content
 */
async function loadFile(file: string): Promise<string> {
  if (file.startsWith("s3://")) {
    return await loadS3File(file);
  }
  return await readFile(file, "utf-8");
}

/**
 * Loads file from s3
 * @param file - s3 link like s3://bucket/path/to/file.yaml
 * @returns file content
 */
async function loadS3File(file: string): Promise<string> {
  const url = new URL(file);
  const bucket = url.hostname;
  const key = url.pathname.slice(1);

  const s3 = new S3Client({});
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
  if (!response.Body) {
    throw new Error(`file ${file} not found`);
  }
  return response.Body.transformToString("utf-8");
}

/**
 * Given file and a relative file path, returns full path of the relative file
 * Supports s3 links for base file
 * @param file
 * @param relativeFile
 */
export function getRelativePath(
  baseFile: string,
  relativeFile: string,
): string {
  if (baseFile.startsWith("s3://")) {
    const url = new URL(baseFile);
    const relPathname = pathResolve(dirname(url.pathname), relativeFile);
    url.pathname = relPathname;
    return url.toString();
  }
  return pathResolve(dirname(baseFile), relativeFile);
}
