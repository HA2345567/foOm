import { createRequestHandler } from "@tanstack/react-start-server";
import { getRouter } from "../src/router";

const handler = createRequestHandler({
  getRouter,
});

export default async function (req, res) {
  return handler(req, res);
}
