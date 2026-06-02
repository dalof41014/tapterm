import { Eye, EyeOff } from "lucide-react";
import { InputHTMLAttributes, ReactNode, useState } from "react";

interface PasswordInputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: ReactNode;
}

/** Password field with a show/hide eye toggle. */
export function PasswordInput({ leftIcon, className, ...rest }: PasswordInputProps) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      {leftIcon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint">
          {leftIcon}
        </span>
      )}
      <input
        {...rest}
        type={show ? "text" : "password"}
        className={`${className ?? "input"} pr-9`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-content-faint transition-colors duration-200 hover:text-content"
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}
