import { useState } from "react";
import { nanoid } from "nanoid";
import { Modal, Field } from "../ui/Modal";
import { useStore } from "../../store/useStore";
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

  const save = async () => {
    let auth: AuthMethod;
    if (authKind === "Password") auth = { kind: "Password", value: password };
    else if (authKind === "Key") auth = { kind: "Key", value: keyId };
    else auth = { kind: "Agent" };

    const next: Host = {
      id: host?.id ?? nanoid(10),
      label: label || address,
      address,
      port: Number(port) || 22,
      username,
      auth,
      color,
      groupId: groupId || null,
      os: host?.os ?? null,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
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
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
          />
        )}
        {authKind === "Key" && (
          keys.length ? (
            <select className="input" value={keyId} onChange={(e) => setKeyId(e.target.value)}>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-warn">Add an SSH key in the Keychain first.</p>
          )
        )}
        {authKind === "Agent" && (
          <p className="text-xs text-content-faint">Uses the system SSH agent (if available).</p>
        )}
      </Field>

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
