type ConfirmDialogProps = {
  title: string;
  message: string;
  isLoading?: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
};

export const ConfirmDialog = ({
  title,
  message,
  isLoading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={isLoading}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => void onConfirm()}
            disabled={isLoading}
          >
            {isLoading ? "Deleting..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
};
