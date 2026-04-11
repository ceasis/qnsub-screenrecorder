import React from 'react';

type EditorTabProps = {
  pendingProject?: { projectPath: string; originalPath: string } | null;
  onProjectConsumed?: () => void;
};

export default function EditorTab(_props: EditorTabProps = {}) {
  return (
    <>
      <div className="tab-toolbar">
        <div className="status">Video Editor</div>
      </div>
      <main className="editor-coming-soon">
        <div className="coming-soon-card">
          <div className="coming-soon-icon">🎬</div>
          <h2>Coming soon</h2>
          <p>The video editor is being rebuilt from scratch.</p>
          <p className="muted">
            Recordings still save to disk. The editor will return in a
            future release.
          </p>
        </div>
      </main>
    </>
  );
}
