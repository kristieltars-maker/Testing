import { useRef, useState, useEffect } from 'react';

export default function MessageComposer({
  text,
  setText,
  files,
  setFiles,
  onSubmit,
  submitLabel = 'Отправить',
  disabled = false,
  sendOnEnter = true,
  placeholder,
  height,
  onResizeStart
}) {
  const [drag, setDrag] = useState(false);
  const [previews, setPreviews] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const urls = files.map(f => ({ file: f, url: URL.createObjectURL(f) }));
    setPreviews(urls);
    return () => urls.forEach(u => URL.revokeObjectURL(u.url));
  }, [files]);

  const addFiles = (list) => {
    const images = Array.from(list).filter(f => f.type.startsWith('image/'));
    if (images.length) setFiles([...files, ...images]);
  };

  const handleKeyDown = (e) => {
    if (sendOnEnter && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      if (!disabled) onSubmit?.();
    }
  };

  return (
    <div style={{ flexShrink: 0 }}>
      {onResizeStart && (
        <div
          onMouseDown={onResizeStart}
          title="Потяните, чтобы изменить высоту поля ввода"
          style={{ height: 10, cursor: 'row-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div style={{ width: 44, height: 4, borderRadius: 2, background: '#d1d5db' }} />
        </div>
      )}
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}
        style={{
          border: `2px dashed ${drag ? '#3498db' : 'transparent'}`,
          background: drag ? '#eef6fd' : 'transparent',
          borderRadius: 12,
          padding: 4,
          transition: 'background .15s ease, border-color .15s ease'
        }}
      >
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, background: '#fff' }}>
        {previews.length > 0 && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            {previews.map((p, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img
                  src={p.url}
                  alt={p.file.name}
                  title={p.file.name}
                  style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }}
                />
                <button
                  type="button"
                  title="Убрать"
                  onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                  style={{ position: 'absolute', top: -8, right: -8, width: 22, height: 22, padding: 0, borderRadius: '50%', background: '#e74c3c', lineHeight: '18px', fontSize: 14 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={e => { if (e.clipboardData?.files?.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
          placeholder={placeholder || (previews.length > 0 ? 'Подпись к изображению...' : 'Написать сообщение...')}
          rows={3}
          style={{ width: '100%', height: height || undefined, minHeight: height ? undefined : 64, padding: 8, border: 'none', outline: 'none', resize: height ? 'none' : 'vertical', background: 'transparent', overflowY: 'auto' }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <button
            type="button"
            className="btn-secondary btn-sm"
            title="Прикрепить скриншот (можно перетащить или вставить Ctrl+V)"
            onClick={() => fileInputRef.current?.click()}
          >
            📎 Скриншот
          </button>
          {submitLabel && (
            <button
              type="button"
              onClick={() => onSubmit?.()}
              disabled={disabled}
              style={{ padding: '8px 20px' }}
            >
              {submitLabel}
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
      />
      </div>
    </div>
  );
}
