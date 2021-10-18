import Router from ".";
import { STATUS_CODES } from "http";

async function main() {
  const router = new Router();

  router.get("/", (req, res) => {
    return res.file(require.main!.filename, "text/typescript");
  });

  router.get("/json", (req, res) => {
    return res.status(200).json({
      env: process.env,
      codes: STATUS_CODES
    }, 2);
  });

  const addr = await router.listen(":80");
  console.log("Listening", addr.url);
}

main().catch(e => {
  console.error(e);
  process.exit();
});