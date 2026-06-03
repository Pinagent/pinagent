export function SidebarFooter() {
  return (
    <footer
      style={{
        marginTop: 'auto',
        paddingTop: 16,
        borderTop: '1px solid #e5e7eb',
        fontSize: 12,
        color: '#6b7280',
      }}
    >
      <div style={{ fontWeight: 500, color: '#4b5563' }}>Signed in as dev</div>
      <a href="#settings" style={{ color: '#6b7280', textDecoration: 'none' }}>
        v0.1.0 · Settings
      </a>
    </footer>
  );
}
