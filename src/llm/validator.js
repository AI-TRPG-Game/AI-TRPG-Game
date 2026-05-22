export function tryParseJson(text) {
  // Basic repair: slice from first '{' to last '}'
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  const slice = a >= 0 && b >= 0 && b > a ? text.slice(a, b + 1) : text;

  const obj = JSON.parse(slice);

  if (typeof obj.narrative !== "string") throw new Error("narrative must be string");
  if (!Array.isArray(obj.options)) obj.options = [];
  if (typeof obj.needs_roll !== "boolean") obj.needs_roll = false;
  if (!("roll" in obj)) obj.roll = null;
  if (!("state_updates" in obj)) obj.state_updates = null;

  return obj;
}
