import { useState } from "react";

type LoginFormProps = {
  isLoading: boolean;
  error: string | null;
  onSubmit: (accessKeyId: string, secretAccessKey: string) => Promise<void>;
};

export const LoginForm = ({ isLoading, error, onSubmit }: LoginFormProps) => {
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSubmit(accessKeyId.trim(), secretAccessKey.trim());
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Atrium</h1>
        <p>Secure S3 Browser for your object storage.</p>

        <label>
          Access Key ID
          <input
            type="text"
            value={accessKeyId}
            onChange={(event) => setAccessKeyId(event.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label>
          Secret Access Key
          <input
            type="password"
            value={secretAccessKey}
            onChange={(event) => setSecretAccessKey(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error ? <div className="error-banner">{error}</div> : null}

        <button type="submit" disabled={isLoading}>
          {isLoading ? "Authenticating..." : "Sign In"}
        </button>
      </form>
    </div>
  );
};
