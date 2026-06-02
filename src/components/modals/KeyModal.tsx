import { useState } from "react";
import { nanoid } from "nanoid";
import { Modal, Field } from "../ui/Modal";
import { PasswordInput } from "../ui/PasswordInput";
import { useStore } from "../../store/useStore";
import type { SshKey } from "../../lib/types";

export function KeyModal({ sshKey, onClose }: { sshKey?: SshKey; onClose: () => void }) {
  const saveKey = useStore((s) => s.saveKey);
  const [label, setLabel] = useState(sshKey?.label ?? "");
  const [privateKey, setPrivateKey] = useState(sshKey?.privateKey ?? "");
  const [passphrase, setPassphrase] = useState(sshKey?.passphrase ?? "");
  const [publicKey, setPublicKey] = useState(sshKey?.publicKey ?? "");

  const save = async () => {
    const next: SshKey = {
      id: sshKey?.id ?? nanoid(10),
      label: label || "Unnamed key",
      privateKey,
      passphrase: passphrase || null,
      publicKey: publicKey || null,
    };
    await saveKey(next);
    onClose();
  };

  return (
    <Modal
      title={sshKey ? "Edit Key" : "Add SSH Key"}
      subtitle="Stored encrypted. Paste an OpenSSH private key."
      width="max-w-xl"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={!privateKey}>
            Save
          </button>
        </>
      }
    >
      <Field label="Label">
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="id_ed25519" />
      </Field>
      <Field label="Private key (PEM / OpenSSH)">
        <textarea
          className="input h-40 resize-none font-mono text-xs leading-relaxed"
          value={privateKey}
          onChange={(e) => setPrivateKey(e.target.value)}
          placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n…"}
          spellCheck={false}
        />
      </Field>
      <Field label="Passphrase" hint="Leave empty if the key is not encrypted.">
        <PasswordInput
          className="input"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
        />
      </Field>
      <Field label="Public key (optional)">
        <input
          className="input font-mono text-xs"
          value={publicKey}
          onChange={(e) => setPublicKey(e.target.value)}
          placeholder="ssh-ed25519 AAAA…"
        />
      </Field>
    </Modal>
  );
}
