import { Button } from './ui.jsx';

const TABS = [
  { id: 'lot', label: 'Lot', icon: '🏏' },
  { id: 'purses', label: 'Purses', icon: '💰' },
  { id: 'chat', label: 'Chat', icon: '💬' },
];

export default function TabBar({ activeTab, onTabChange, unreadChatCount = 0 }) {
  return (
    <nav className="tab-bar" role="tablist" aria-label="Auction sections">
      {TABS.map((tab) => (
        <Button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`${tab.id}-panel`}
          id={`${tab.id}-tab`}
          variant={activeTab === tab.id ? 'accent' : 'quiet'}
          className="tab-btn"
          onClick={() => onTabChange(tab.id)}
        >
          <span className="tab-icon" aria-hidden="true">{tab.icon}</span>
          <span className="tab-label">{tab.label}</span>
          {tab.id === 'chat' && unreadChatCount > 0 && (
            <span className="tab-badge" aria-label={`${unreadChatCount} unread messages`}>
              {unreadChatCount > 9 ? '9+' : unreadChatCount}
            </span>
          )}
        </Button>
      ))}
    </nav>
  );
}