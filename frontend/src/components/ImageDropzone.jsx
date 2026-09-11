import { useRef, useState, useEffect } from 'react';

export default function ImageDropzone({
  files,
  onChange,
  hint = 'Перетащите скриншоты сюда или нажмите для выбора',
  compact = false
}) {
  const [drag, setDrag] = useState(false);
  const [previews, setPreviews] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    const urls = files.map(f => ({ file: f, url: URL.createObjectURL(f) }));
    setPreviews(urls);
    return () => urls.forEach(u => URL.revokeObjectURL(u.url));
  }, [files]);

  const addFiles = (list) => {
    const images = Array.from(list).filter(f => f.type.startsWith('image/'));
    if (images.length) onChange([...files, ...images]);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const onPaste = (e) => {
    const items = e.clipboardData?.files;
    if (items?.length) addFiles(items);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      onPaste={onPaste}
      onClick={() => inputRef.current?.click()}
      tabIndex={0}
      style={{
        border: `2px dashed ${drag ? '#3498db' : '#d1d5db'}`,
        borderRadius: 8,
        padding: compact ? 10 : 16,
        textAlign: 'center',
        cursor: 'pointer',
        background: drag ? '#eef6fd' : '#fafafa',
        outline: 'none'
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
      />
      <div className="muted" style={{ fontSize: 13 }}>{hint}</div>

      {previews.length > 0 && (
        <div
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, justifyContent: 'center' }}
          onClick={e => e.stopPropagation()}
        >
          {previews.map((p, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img
                src={p.url}
                alt={p.file.name}
                title={p.file.name}
                style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid #e5e7eb' }}
              />
              <button
                type="button"
                title="Убрать"
                onClick={() => onChange(files.filter((_, idx) => idx !== i))}
                style={{
                  position: 'absolute', top: -6, right: -6, width: 20, height: 20,
                  padding: 0, borderRadius: '50%', background: '#e74c3c',
                  lineHeight: '16px', fontSize: 13
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
