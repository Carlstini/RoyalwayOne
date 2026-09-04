import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type UploadedFile } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Dropzone } from '../components/Dropzone';
import { FileList } from '../components/FileList';
import { DocumentChat } from '../components/DocumentChat';
import { Icon } from '../components/Icon';
import { setMeta } from './ToolPage';

const ACCEPT = ['application/pdf', '.pdf', '.docx', '.txt', '.md', '.csv', '.xlsx', '.pptx', 'image/*'];

export function DocumentChatPage() {
  const workspace = useWorkspace();
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Ask your document — Royalway One';
    setMeta('description', 'Upload a document and ask questions about it. Answers are grounded in the document, with the exact excerpts used.');
  }, []);

  const onFiles = useCallback(async (files: File[]) => {
    setUploading(true);
    setError(null);
    try {
      const res = await api.upload([files[0]]);
      workspace.addFiles(res.files);
      setFile(res.files[0]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not upload that document.');
    } finally {
      setUploading(false);
    }
  }, [workspace]);

  const existing = workspace.files.filter((f) => f.id !== file?.id).slice(0, 5);

  return (
    <div className="page page--narrow">
      <h1>Ask your document</h1>
      <p className="muted">Upload a document and ask anything about it. Every answer is grounded in what the document actually says — if it is not in there, we will tell you.</p>

      <div className="stack" style={{ marginTop: 24, gap: 18 }}>
        {!file && (
          <>
            <Dropzone accept={ACCEPT} multiple={false} disabled={uploading}
              title={uploading ? 'Uploading…' : 'Drop a document here'}
              hint="PDF, Word, text, spreadsheets, presentations or a scanned image"
              onFiles={onFiles} />
            {existing.length > 0 && (
              <div>
                <div className="small muted" style={{ marginBottom: 8 }}>Already in your workspace</div>
                <div className="chips">
                  {existing.map((f) => <button key={f.id} className="chip" onClick={() => setFile(f)}>{f.name}</button>)}
                </div>
              </div>
            )}
          </>
        )}

        {error && <div className="banner banner--error" role="alert"><Icon name="info" size={18} /> {error}</div>}

        {file && (
          <>
            <FileList files={[file]} onRemove={() => setFile(null)} />
            <DocumentChat fileId={file.id} documentName={file.name} available={workspace.capabilities.ai} />
          </>
        )}
      </div>
    </div>
  );
}
