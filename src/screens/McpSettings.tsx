import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { desktopMcpHost, type McpConnectionInfo } from '../platform/desktop';
import { colors, fonts, radii, type } from '../theme';

// Settings → Coding agents: how to point Claude Code (or any MCP client) at
// the server in desktop/src/mcp.js. Renders nothing outside the desktop shell.
export function McpSettings() {
  const host = desktopMcpHost();
  const [info, setInfo] = React.useState<McpConnectionInfo | null | undefined>(undefined);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!host) return;
    let alive = true;
    host
      .info()
      .then((i) => alive && setInfo(i))
      .catch(() => alive && setInfo(null));
    return () => {
      alive = false;
    };
  }, [host]);

  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  if (!host) return null;

  const copy = async () => {
    if (!info) return;
    await Clipboard.setStringAsync(info.claudeCommand);
    setCopied(true);
  };

  return (
    <>
      <View style={styles.section}>
        <Text style={type.sectionLabel}>Coding agents</Text>
        <View style={styles.card}>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: info ? colors.success : colors.lineFaint }]} />
            <Text style={styles.statusText} numberOfLines={1} ellipsizeMode="middle">
              {info === undefined ? 'Starting…' : info ? `MCP server on ${info.url}` : 'MCP server is not running'}
            </Text>
          </View>
          {info ? (
            <View style={styles.commandRow}>
              <Text style={styles.command} selectable numberOfLines={3}>
                {info.claudeCommand}
              </Text>
              <Pressable
                style={({ pressed }) => [styles.copyBtn, pressed && styles.pressed]}
                onPress={copy}
                accessibilityRole="button"
                accessibilityLabel="Copy Claude Code command"
              >
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={colors.chalk} />
                <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
      <Text style={styles.hint}>
        Run this in a terminal and Claude Code can build apps right here: it creates and opens
        apps, edits their files and screenshots the result while you watch. The command holds a
        secret token, so don't share it.
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  card: {
    backgroundColor: colors.board,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  statusRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.chalk },
  commandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 10,
  },
  command: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 17,
    color: colors.chalkMuted,
  },
  copyBtn: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.raised,
  },
  copyText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.chalk },
  pressed: { opacity: 0.75 },
  hint: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.dust,
    paddingHorizontal: 4,
    marginTop: -14,
  },
});
