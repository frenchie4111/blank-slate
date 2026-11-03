import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Lexer, type Token, type Tokens } from 'marked';
import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, noLigatures, radii } from '../theme';

// Chat-sized markdown renderer on top of marked's lexer (pure JS, no native
// code). Each top-level block is memoized on its raw source, so while a reply
// streams only the last block re-renders — earlier paragraphs and finished
// code blocks are skipped by React.memo.
// useDeferredValue lets React drop intermediate chunks if lexing a long reply
// falls behind the stream.
export const Markdown = React.memo(function Markdown({ text: liveText }: { text: string }) {
  const text = React.useDeferredValue(liveText);
  const tokens = React.useMemo(() => lex(text), [text]);
  if (!tokens) return <Text style={styles.text}>{text}</Text>;
  const blocks = tokens.filter((t) => t.type !== 'space' && t.type !== 'def');
  return (
    <View style={styles.root}>
      {blocks.map((t, i) => (
        <Block key={i} token={t} raw={t.raw} />
      ))}
    </View>
  );
});

function lex(text: string): Token[] | null {
  try {
    return Lexer.lex(text, { gfm: true });
  } catch {
    return null;
  }
}

const Block = React.memo(
  function Block({ token }: { token: Token; raw: string }) {
    return <>{renderBlock(token)}</>;
  },
  (a, b) => a.raw === b.raw,
);

function renderBlock(t: Token, key?: React.Key): React.ReactNode {
  switch (t.type) {
    case 'heading': {
      const h = t as Tokens.Heading;
      return (
        <Text key={key} style={[styles.text, styles.heading, h.depth <= 2 && styles.headingLarge]}>
          {renderInline(h.tokens)}
        </Text>
      );
    }
    case 'paragraph':
      return (
        <Text key={key} style={styles.text}>
          {renderInline((t as Tokens.Paragraph).tokens)}
        </Text>
      );
    case 'text': {
      const tt = t as Tokens.Text;
      return (
        <Text key={key} style={styles.text}>
          {tt.tokens ? renderInline(tt.tokens) : tt.text}
        </Text>
      );
    }
    case 'code':
      return <CodeBlock key={key} code={(t as Tokens.Code).text} lang={(t as Tokens.Code).lang} />;
    case 'blockquote':
      return (
        <View key={key} style={styles.quote}>
          {renderBlocks((t as Tokens.Blockquote).tokens)}
        </View>
      );
    case 'list':
      return <List key={key} list={t as Tokens.List} />;
    case 'hr':
      return <View key={key} style={styles.hr} />;
    case 'table':
      return <Table key={key} table={t as Tokens.Table} />;
    case 'html':
      return (
        <Text key={key} style={styles.text}>
          {(t as Tokens.HTML).text.trim()}
        </Text>
      );
    case 'space':
    case 'def':
      return null;
    default:
      return 'raw' in t && t.raw.trim() ? (
        <Text key={key} style={styles.text}>
          {t.raw.trim()}
        </Text>
      ) : null;
  }
}

function renderBlocks(tokens: Token[]): React.ReactNode[] {
  return tokens
    .filter((t) => t.type !== 'space' && t.type !== 'def')
    .map((t, i) => renderBlock(t, i));
}

function renderInline(tokens: Token[] | undefined): React.ReactNode[] {
  if (!tokens) return [];
  return tokens.map((t, i) => {
    switch (t.type) {
      case 'strong':
        return (
          <Text key={i} style={styles.bold}>
            {renderInline((t as Tokens.Strong).tokens)}
          </Text>
        );
      case 'em':
        return (
          <Text key={i} style={styles.italic}>
            {renderInline((t as Tokens.Em).tokens)}
          </Text>
        );
      case 'del':
        return (
          <Text key={i} style={styles.strike}>
            {renderInline((t as Tokens.Del).tokens)}
          </Text>
        );
      case 'codespan':
        return (
          <Text key={i} style={styles.inlineCode}>
            {(t as Tokens.Codespan).text}
          </Text>
        );
      case 'br':
        return '\n';
      case 'link': {
        const l = t as Tokens.Link;
        return (
          <Text key={i} style={styles.link} onPress={() => openLink(l.href)}>
            {renderInline(l.tokens)}
          </Text>
        );
      }
      case 'image': {
        const img = t as Tokens.Image;
        return (
          <Text key={i} style={styles.link} onPress={() => openLink(img.href)}>
            {img.text || img.href}
          </Text>
        );
      }
      case 'text': {
        const tt = t as Tokens.Text;
        return tt.tokens ? (
          <React.Fragment key={i}>{renderInline(tt.tokens)}</React.Fragment>
        ) : (
          tt.text
        );
      }
      case 'escape':
        return (t as Tokens.Escape).text;
      case 'html':
        return (t as Tokens.HTML).text;
      default:
        return 'raw' in t ? t.raw : null;
    }
  });
}

function openLink(href: string) {
  if (!/^(https?:|mailto:|tel:)/i.test(href)) return;
  Linking.openURL(href).catch(() => {});
}

function List({ list }: { list: Tokens.List }) {
  const start = typeof list.start === 'number' ? list.start : 1;
  return (
    <View style={styles.list}>
      {list.items.map((item, i) => (
        <View key={i} style={styles.listItem}>
          {item.task ? (
            <View style={styles.taskBox}>
              <Ionicons
                name={item.checked ? 'checkbox-outline' : 'square-outline'}
                size={15}
                color={item.checked ? colors.success : colors.dust}
              />
            </View>
          ) : (
            <Text style={[styles.text, styles.bullet]}>
              {list.ordered ? `${start + i}.` : '•'}
            </Text>
          )}
          <View style={styles.listBody}>{renderBlocks(item.tokens)}</View>
        </View>
      ))}
    </View>
  );
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    Clipboard.setStringAsync(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };
  return (
    <View style={styles.codeBlock}>
      <View style={styles.codeHeader}>
        <Text style={styles.codeLang}>{lang || 'code'}</Text>
        <Pressable onPress={copy} hitSlop={8} style={styles.copyBtn}>
          <Ionicons
            name={copied ? 'checkmark' : 'copy-outline'}
            size={12}
            color={copied ? colors.success : colors.dust}
          />
          <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeScroll}>
        <Text style={styles.codeText}>{code}</Text>
      </ScrollView>
    </View>
  );
}

function Table({ table }: { table: Tokens.Table }) {
  const row = (cells: Tokens.TableCell[], header: boolean, key: React.Key) => (
    <View key={key} style={[styles.tableRow, header && styles.tableHeaderRow]}>
      {cells.map((c, i) => (
        <View key={i} style={styles.tableCell}>
          <Text style={[styles.text, header && styles.bold]}>{renderInline(c.tokens)}</Text>
        </View>
      ))}
    </View>
  );
  return (
    <ScrollView horizontal>
      <View style={styles.table}>
        {row(table.header, true, 'h')}
        {table.rows.map((r, i) => row(r, false, i))}
      </View>
    </ScrollView>
  );
}

// Assistant replies sit on the slate with no bubble: chalkMuted body copy,
// chalk for emphasis, mono on `raised` for code.
const styles = StyleSheet.create({
  root: { gap: 10 },
  text: { fontFamily: fonts.body, fontSize: 15, lineHeight: 23, color: colors.chalkMuted },
  heading: { fontFamily: fonts.displaySemi, color: colors.chalk, marginTop: 4 },
  headingLarge: { fontSize: 18, lineHeight: 24, letterSpacing: -0.2 },
  bold: { fontFamily: fonts.bodySemi, color: colors.chalk },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  link: { color: colors.chalk, textDecorationLine: 'underline' },
  inlineCode: {
    ...noLigatures,
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.chalk,
    backgroundColor: colors.raised,
  },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: colors.lineStrong,
    paddingLeft: 12,
    gap: 6,
  },
  hr: { height: 1, backgroundColor: colors.line, marginVertical: 4 },
  list: { gap: 4 },
  listItem: { flexDirection: 'row' },
  bullet: { minWidth: 18, paddingRight: 4, color: colors.dust },
  taskBox: { minWidth: 22, paddingTop: 4 },
  listBody: { flex: 1, flexShrink: 1, gap: 6 },
  codeBlock: {
    backgroundColor: colors.board,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  codeLang: { fontFamily: fonts.mono, fontSize: 11, color: colors.dust },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  copyText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.dust },
  codeScroll: { paddingHorizontal: 12, paddingVertical: 10 },
  codeText: { ...noLigatures, fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: colors.chalkSoft },
  table: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.chip,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  tableHeaderRow: { borderTopWidth: 0, backgroundColor: colors.board },
  tableCell: { width: 130, paddingHorizontal: 10, paddingVertical: 6 },
});
