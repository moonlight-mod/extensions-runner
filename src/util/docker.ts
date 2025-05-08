import { Readable } from "node:stream";
import { Agent, fetch } from "undici";

export type CreateRequest = {
  Image: string;
  Env?: string[];
  Tty?: boolean;
  NetworkDisabled?: boolean;
  HostConfig?: {
    Mounts?: {
      Target: string; // container path
      Source: string; // host path
      Type: "bind";
      ReadOnly?: boolean;
    }[];
    AutoRemove?: boolean;
    // FIXME: CPU/RAM/disk/time limits
  };
};

const agent = new Agent({
  connect: {
    socketPath: "/var/run/docker.sock"
  },
  bodyTimeout: 0 // for log streaming
});
const version = "v1.40"; // picked randomly since idk what's recent-ish

async function create(config: CreateRequest) {
  const resp = await fetch(`http://localhost/${version}/containers/create`, {
    dispatcher: agent,
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(config)
  });

  if (!resp.ok) throw new Error(resp.statusText);

  const data = (await resp.json()) as { Id: string };
  return data.Id;
}

async function start(id: string) {
  const resp = await fetch(`http://localhost/${version}/containers/${id}/start`, {
    dispatcher: agent,
    method: "POST"
  });

  if (!resp.ok) throw new Error(resp.statusText);
}

async function attach(id: string) {
  const url = new URL(`http://localhost/${version}/containers/${id}/attach`);
  url.searchParams.append("stream", "true");
  url.searchParams.append("stdout", "true");
  url.searchParams.append("stderr", "true");
  url.searchParams.append("logs", "true");

  const resp = await fetch(url, {
    dispatcher: agent,
    method: "POST"
  });
  if (!resp.ok) throw new Error(resp.statusText);

  return Readable.fromWeb(resp.body!).pipe(process.stdout);
}

async function wait(id: string) {
  const resp = await fetch(`http://localhost/${version}/containers/${id}/wait`, {
    dispatcher: agent,
    method: "POST"
  });

  if (!resp.ok) throw new Error(resp.statusText);

  const data = (await resp.json()) as { StatusCode: number };
  if (data.StatusCode !== 0) throw new Error(`Container exited with code ${data.StatusCode}`);
}

export default async function runContainer(config: CreateRequest) {
  console.log("Starting container:", config);
  const id = await create(config);
  console.log("Container created:", id);

  await start(id);
  const stream = await attach(id);

  try {
    await wait(id);
  } finally {
    stream.destroy();
  }
}
