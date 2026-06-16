import React from "react";
import { FileText, History, Plus, Trash2 } from "lucide-react";
import type { RebuttalItem } from "../types";

interface RebuttalSidebarProps {
  items: RebuttalItem[];
  onAddItem: () => void;
  onAddRebuttalToSource: () => void;
  onUpdateItem: (id: string, updates: Partial<RebuttalItem>) => void;
  onDeleteItem: (id: string) => void;
  onGenerateLetter?: () => void;
}

export const RebuttalSidebar: React.FC<RebuttalSidebarProps> = ({
  items,
  onAddItem,
  onAddRebuttalToSource,
  onUpdateItem,
  onDeleteItem,
  onGenerateLetter,
}) => {
  return (
    <div className="rebuttal-sidebar">
      <div className="sidebar-header-actions">
        <button className="sidebar-primary-action" onClick={onAddItem}>
          <Plus size={14} />
          <span>New Rebuttal Item</span>
        </button>
        <button className="sidebar-primary-action" onClick={onAddRebuttalToSource}>
          <Plus size={14} />
          <span>Insert in Source</span>
        </button>
        {onGenerateLetter && (
          <button className="sidebar-primary-action" onClick={onGenerateLetter}>
            <FileText size={14} />
            <span>Generate Letter</span>
          </button>
        )}
      </div>

      <div className="sidebar-list">
        {items.length === 0 ? (
          <div className="sidebar-empty">
            <History size={32} />
            <p>No rebuttal items yet.</p>
            <p className="sub-text">Click "New Rebuttal Item" to track your responses to reviewer comments.</p>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="sidebar-item-card rebuttal-item-card">
              <div className="rebuttal-item-header">
                <strong>Rebuttal Item</strong>
                <button 
                  className="small-icon delete-button" 
                  onClick={() => onDeleteItem(item.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>

              <div className="rebuttal-field">
                <label>Reviewer Comment</label>
                <textarea
                  value={item.reviewerComment}
                  onChange={(e) => onUpdateItem(item.id, { reviewerComment: e.target.value })}
                  placeholder="What did the reviewer say?"
                />
              </div>

              <div className="rebuttal-field">
                <label>Author Response</label>
                <textarea
                  value={item.authorComment}
                  onChange={(e) => onUpdateItem(item.id, { authorComment: e.target.value })}
                  placeholder="How do you respond?"
                />
              </div>

              <div className="rebuttal-field">
                <label>Modification Made</label>
                <textarea
                  value={item.modificationMade}
                  onChange={(e) => onUpdateItem(item.id, { modificationMade: e.target.value })}
                  placeholder="What changes did you make in the LaTeX?"
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
