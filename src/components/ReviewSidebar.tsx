import React from "react";
import { MessageSquare, Plus, Trash2, User } from "lucide-react";
import type { ReviewChat, ReviewChatComment } from "../types";

interface ReviewSidebarProps {
  chats: ReviewChat[];
  onAddChat: () => void;
  onAddComment: (chatId: string, text: string) => void;
  onDeleteChat: (chatId: string) => void;
  onJumpToSelection: (chat: ReviewChat) => void;
}

export const ReviewSidebar: React.FC<ReviewSidebarProps> = ({
  chats,
  onAddChat,
  onAddComment,
  onDeleteChat,
  onJumpToSelection,
}) => {
  const [commentTexts, setCommentTexts] = React.useState<Record<string, string>>({});

  return (
    <div className="review-sidebar">
      <div className="sidebar-header-actions">
        <button className="sidebar-primary-action" onClick={onAddChat}>
          <Plus size={14} />
          <span>New Review Comment</span>
        </button>
      </div>

      <div className="sidebar-list">
        {chats.length === 0 ? (
          <div className="sidebar-empty">
            <MessageSquare size={32} />
            <p>No review comments yet.</p>
            <p className="sub-text">Select text in the editor and click "New Review Comment" to start a discussion.</p>
          </div>
        ) : (
          chats.map((chat) => (
            <div key={chat.id} className="sidebar-item-card review-chat-card">
              <div className="review-chat-header">
                <div 
                  className="review-chat-selection" 
                  onClick={() => onJumpToSelection(chat)}
                  title="Click to jump to selection"
                >
                  "{chat.selection.text.substring(0, 50)}{chat.selection.text.length > 50 ? "..." : ""}"
                </div>
                <button 
                  className="small-icon delete-button" 
                  onClick={() => onDeleteChat(chat.id)}
                  title="Delete review chat"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              
              <div className="review-comments-list">
                {chat.comments.map((comment) => (
                  <div key={comment.id} className="review-comment">
                    <div className="comment-meta">
                      <User size={12} />
                      <span className="comment-author">{comment.author}</span>
                      <span className="comment-time">
                        {new Date(comment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="comment-text">{comment.text}</div>
                  </div>
                ))}
              </div>

              <div className="comment-input-area">
                <textarea
                  placeholder="Reply..."
                  value={commentTexts[chat.id] || ""}
                  onChange={(e) => setCommentTexts(prev => ({ ...prev, [chat.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (commentTexts[chat.id]?.trim()) {
                        onAddComment(chat.id, commentTexts[chat.id]);
                        setCommentTexts(prev => ({ ...prev, [chat.id]: "" }));
                      }
                    }
                  }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
