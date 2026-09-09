import { parseServerEnvironment } from "@approveflow/config";
import { createApp } from "./app.js";

const environment = parseServerEnvironment(process.env);
const app = createApp(environment.WEB_ORIGIN);

app.listen(environment.API_PORT, environment.API_HOST, () => {
  process.stdout.write(
    `ApproveFlow API listening on ${environment.API_HOST}:${String(environment.API_PORT)}\n`,
  );
});
