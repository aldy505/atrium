import { useMemo, useState } from "react";

type CreateFolderDialogProps = {
  bucket: string;
  prefix: string;
  isLoading?: boolean;
  onCreate: (name: string) => Promise<void>;
  onCancel: () => void;
};

const MAX_FOLDER_NAME_LENGTH = 1024;

const getValidationError = (value: string): string | null => {
  const trimmed = value.trim();

  if (!trimmed) {
    return "Folder name is required.";
  }

  if (trimmed === "." || trimmed === "..") {
    return "Folder name cannot be . or ..";
  }

  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return "Folder name cannot contain / or backslash.";
  }

  if (trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    return "Folder name is too long.";
  }

  return null;
};

export const CreateFolderDialog = ({
  bucket,
  prefix,
  isLoading,
  onCreate,
  onCancel,
}: CreateFolderDialogProps) => {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validationError = useMemo(() => getValidationError(value), [value]);
  const locationLabel = prefix ? `${bucket}/${prefix}` : bucket;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    setError(null);

    if (validationError) {
      return;
    }

    try {
      await onCreate(value.trim());
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create folder");
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-folder-title"
    >
      <div className="modal-card">
        <h3 id="create-folder-title">Create folder</h3>
        <form className="modal-form" onSubmit={handleSubmit}>
          <label className="modal-field">
            <span>Folder name</span>
            <input
              type="text"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
              onBlur={() => setTouched(true)}
              autoFocus
              disabled={isLoading}
              placeholder="e.g. invoices"
            />
          </label>
          <p className="modal-hint">Location: {locationLabel || "(select a bucket)"}</p>
          {touched && validationError ? (
            <p className="modal-error" role="alert">
              {validationError}
            </p>
          ) : null}
          {error ? (
            <p className="modal-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            <button type="button" onClick={onCancel} disabled={isLoading}>
              Cancel
            </button>
            <button type="submit" disabled={Boolean(validationError) || isLoading}>
              {isLoading ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
