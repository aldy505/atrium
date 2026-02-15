type BreadcrumbsProps = {
  bucket: string;
  prefix: string;
  onNavigate: (prefix: string) => void;
};

export const Breadcrumbs = ({ bucket, prefix, onNavigate }: BreadcrumbsProps) => {
  const parts = prefix.split("/").filter(Boolean);

  return (
    <div className="breadcrumbs">
      <button type="button" onClick={() => onNavigate("")}>
        {bucket}
      </button>
      {parts.map((part, index) => {
        const nextPrefix = `${parts.slice(0, index + 1).join("/")}/`;
        return (
          <span key={nextPrefix}>
            <span className="separator">/</span>
            <button type="button" onClick={() => onNavigate(nextPrefix)}>
              {part}
            </button>
          </span>
        );
      })}
    </div>
  );
};
