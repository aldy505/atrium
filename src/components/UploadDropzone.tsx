import { useRef } from "react";

type UploadDropzoneProps = {
  disabled?: boolean;
  onFilesSelected: (files: FileList) => Promise<void>;
};

export const UploadDropzone = ({ disabled, onFilesSelected }: UploadDropzoneProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div
      className="upload-dropzone"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (disabled || !event.dataTransfer.files.length) {
          return;
        }

        void onFilesSelected(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="visually-hidden"
        onChange={(event) => {
          if (event.target.files) {
            void onFilesSelected(event.target.files);
            event.currentTarget.value = "";
          }
        }}
        disabled={disabled}
      />
      <p>Drop files here or</p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          inputRef.current?.click();
        }}
      >
        Choose files
      </button>
    </div>
  );
};
