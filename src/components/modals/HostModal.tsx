import { useState } from "react";
import { nanoid } from "nanoid";
import { Modal, Field } from "../ui/Modal";
import { PasswordInput } from "../ui/PasswordInput";
import { useStore } from "../../store/useStore";
import { FONTS } from "../../lib/fonts";
import type { AuthMethod, Host } from "../../lib/types";

const COLORS = ["#22C55E", "#38BDF8", "#FBBF24", "#F43F5E", "#A78BFA", "#F472B6"];

export function HostModal({
  host,
  defaultGroupId,
  onClose,
}: {
  host?: Host;
  defaultGroupId?: string | null;
  onClose: () => void;
}) {
  const keys = useStore((s) => s.vault.keys);
  const groups = useStore((s) => s.vault.groups);
  const saveHost = useStore((s) => s.saveHost);

  const [label, setLabel] = useState(host?.label ?? "");
  const [address, setAddress] = useState(host?.address ?? "");
  const [port, setPort] = useState(host?.port ?? 22);
  const [username, setUsername] = useState(host?.username ?? "root");
  const [authKind, setAuthKind] = useState<AuthMethod["kind"]>(host?.auth.kind ?? "Password");
  const [password, setPassword] = useState(
    host?.auth.kind === "Password" ? host.auth.value : "",
  );
  const [keyId, setKeyId] = useState(host?.auth.kind === "Key" ? host.auth.value : keys[0]?.id ?? "");
  const [color, setColor] = useState(host?.color ?? COLORS[0]);
  const [tags, setTags] = useState((host?.tags ?? []).join(", "));
  const [groupId, setGroupId] = useState(host?.groupId ?? defaultGroupId ?? "");
  const [jumpHostId, setJumpHostId] = useState(host?.jumpHostId ?? "");
  const [font, setFont] = useState(host?.font ?? "");
  const [protocol, setProtocol] = useState<"ssh" | "telnet">(host?.protocol ?? "ssh");
  const [persistent, setPersistent] = useState(host?.persistent ?? false);
  const [persistSession, setPersistSession] = useState(host?.persistSession ?? "");
  const hosts = useStore((s) => s.vault.hosts);

  const changeProtocol = (p: "ssh" | "telnet") => {
    setProtocol(p);
    // swap the well-known default port when it's still at the other default
    if (p === "telnet" && Number(port) === 22) setPort(23);
    if (p === "ssh" && Number(port) === 23) setPort(22);
  };

  const save = async () => {
    let auth: AuthMethod;
    if (protocol === "telnet") auth = { kind: "Agent" };
    else if (authKind === "Password") auth = { kind: "Password", value: password };
    else if (authKind === "Key") auth = { kind: "Key", value: keyId };
    else auth = { kind: "Agent" };

    const next: Host = {
      id: host?.id ?? nanoid(10),
      label: label || address,
      address,
      port: Number(port) || (protocol === "telnet" ? 23 : 22),
      username,
      auth,
      color,
      groupId: groupId || null,
      os: host?.os ?? null,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      jumpHostId: protocol === "telnet" ? null : jumpHostId || null,
      font: font || null,
      protocol,
      persistent: protocol === "telnet" ? false : persistent,
      persistSession: persistSession.trim() || null,
    };
    try {
      await saveHost(next);
      onClose();
    } catch (e) {
      alert("Could not save host: " + String(e));
    }
  };

  return (
    <Modal
      title={host ? "Edit Host" : "New Host"}
      subtitle="Connection details are encrypted in your vault."
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={!address}>
            Save
          </button>
        </>
      }
    >
      <Field label="Label">
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Production DB" />
      </Field>

      <Field label="Protocol">
        <div className="flex gap-1.5">
          {(["ssh", "telnet"] as const).map((p) => (
            <button
              key={p}
              onClick={() => changeProtocol(p)}
              className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium uppercase transition-colors cursor-pointer ${
                protocol === p
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line-strong text-content-muted hover:bg-surface-hover"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label="Address">
            <input
              className="input font-mono"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="192.168.1.10"
            />
          </Field>
        </div>
        <Field label="Port">
          <input
            className="input font-mono"
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
          />
        </Field>
      </div>

      <Field label="Username">
        <input className="input font-mono" value={username} onChange={(e) => setUsername(e.target.value)} />
      </Field>

      <Field label="Group">
        <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">— Ungrouped —</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </Field>

      {protocol === "ssh" && (
        <Field label="Jump host (bastion)" hint="Tunnel this connection through another saved host.">
          <select className="input" value={jumpHostId} onChange={(e) => setJumpHostId(e.target.value)}>
            <option value="">— Direct connection —</option>
            {hosts
              .filter((h) => h.id !== host?.id)
              .map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label} ({h.username}@{h.address})
                </option>
              ))}
          </select>
        </Field>
      )}

      {protocol === "ssh" && (
        <Field label="Persistent session" hint="Wraps the shell in tmux so it survives disconnects and auto-reconnects (requires tmux on the host).">
          <button
            type="button"
            onClick={() => setPersistent((v) => !v)}
            className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
              persistent
                ? "border-accent bg-accent-soft text-content"
                : "border-line-strong text-content-muted hover:bg-surface-hover"
            }`}
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                persistent ? "border-accent bg-accent text-bg" : "border-line-strong"
              }`}
            >
              {persistent && "✓"}
            </span>
            Keep this session alive with tmux
          </button>
          {persistent && (
            <input
              className="input mt-2 font-mono"
              value={persistSession}
              onChange={(e) => setPersistSession(e.target.value)}
              placeholder="tmux session name (default: tapterm)"
            />
          )}
        </Field>
      )}

      <Field label="Terminal font" hint="Overrides the default font for this host only.">
        <select className="input" value={font} onChange={(e) => setFont(e.target.value)}>
          <option value="">— Use default —</option>
          {FONTS.map((f) => (
            <option key={f.id} value={f.id} style={{ fontFamily: f.family }}>
              {f.name}
            </option>
          ))}
        </select>
      </Field>

      {protocol === "telnet" ? (
        <Field label="Authentication">
          <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            Telnet is unencrypted and logs you in interactively — no key/password is stored.
          </p>
        </Field>
      ) : (
        <Field label="Authentication">
          <div className="mb-3 flex gap-1.5">
            {(["Password", "Key", "Agent"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setAuthKind(k)}
                className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  authKind === k
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line-strong text-content-muted hover:bg-surface-hover"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          {authKind === "Password" && (
            <PasswordInput
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
            />
          )}
          {authKind === "Key" &&
            (keys.length ? (
              <select className="input" value={keyId} onChange={(e) => setKeyId(e.target.value)}>
                {keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-warn">Add an SSH key in the Keychain first.</p>
            ))}
          {authKind === "Agent" && (
            <p className="text-xs text-content-faint">Uses the system SSH agent (if available).</p>
          )}
        </Field>
      )}

      <Field label="Color">
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`h-7 w-7 rounded-full transition-transform cursor-pointer ${
                color === c ? "ring-2 ring-offset-2 ring-offset-bg-raised" : ""
              }`}
              style={{ background: c, ...(color === c ? { boxShadow: `0 0 0 2px ${c}` } : {}) }}
              aria-label={c}
            />
          ))}
        </div>
      </Field>

      <Field label="Tags" hint="Comma-separated, e.g. aws, prod">
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="aws, prod" />
      </Field>
    </Modal>
  );
}
