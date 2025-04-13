import { Readable } from "node:stream";
import { Agent, fetch } from "undici";

type CreateRequest = {
  Image: string;
  Env: string[];
  Tty: true;
  NetworkDisabled: boolean;
  HostConfig: {
    Binds: string[];
  };
};

const agent = new Agent({
  connect: {
    socketPath: "/var/run/docker.sock"
  },
  bodyTimeout: 0
});
const version = "v1.40"; // picked randomly since idk what's recent-ish

async function create(hostDirectory: string) {
  const resp = await fetch(`http://localhost/${version}/containers/create`, {
    dispatcher: agent,
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      Image: "moonlight-mod/extensions-runner:latest",
      Env: ["MOONLIGHT_BUILD_MODE=group"],
      Tty: true,
      NetworkDisabled: true,
      HostConfig: {
        Binds: [`${hostDirectory}:/moonlight/group`]
      }
    } satisfies CreateRequest)
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

async function kill(id: string) {
  const url = new URL(`http://localhost/${version}/containers/${id}`);
  url.searchParams.append("force", "true");

  const resp = await fetch(url, {
    dispatcher: agent,
    method: "DELETE"
  });

  if (!resp.ok) throw new Error(resp.statusText);
}

export default async function runContainer(hostDirectory: string) {
  const id = await create(hostDirectory);
  await start(id);
  const stream = await attach(id);

  try {
    await wait(id);
  } finally {
    await kill(id);
    stream.destroy();
  }
}
