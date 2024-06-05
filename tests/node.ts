import { findTests } from "./util/findtests.ts";

const files = await findTests();
for (const file of files) {
  await import(`../${file}`);
}
