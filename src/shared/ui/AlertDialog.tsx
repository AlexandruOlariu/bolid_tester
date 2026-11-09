import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { XStack, YStack, Text, Paragraph, Button } from 'tamagui';
import { HIT_SLOP } from './SegmentedControl';
import { i18n } from '@/shared/i18n';
import { dismissDialog, pressDialogButton, useDialogStore } from '@/shared/state/dialogStore';

type KeyListener = (e: { key?: string }) => void;
interface KeyTarget {
  addEventListener?: (type: 'keydown', fn: KeyListener) => void;
  removeEventListener?: (type: 'keydown', fn: KeyListener) => void;
}

/** The browser's alert box (plan 28 review): renders the dialog `appAlert()` queued on the web —
 *  title, message and the caller's buttons (any number, e.g. the error log's Markdown / JSON
 *  choice). Mounted once in the root layout; renders nothing while no dialog is pending, which is
 *  always on the phone. A tap outside or Escape counts as the Cancel button. */
export function AlertDialog() {
  const dialog = useDialogStore((s) => s.queue[0] ?? null);
  const id = dialog?.id;

  useEffect(() => {
    // Escape closes it in the browser; the phone has no `addEventListener` on the global.
    const w = globalThis as KeyTarget;
    if (id === undefined || !w.addEventListener || !w.removeEventListener) return;
    const onKey = (e: { key?: string }) => {
      if (e.key === 'Escape') dismissDialog(id);
    };
    w.addEventListener('keydown', onKey);
    return () => w.removeEventListener?.('keydown', onKey);
  }, [id]);

  if (!dialog) return null;
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <Pressable
        testID="alert-dialog-backdrop"
        accessible={false}
        onPress={() => dismissDialog(dialog.id)}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.45)',
        }}
      />
      <YStack
        testID="alert-dialog"
        role="alertdialog"
        aria-modal
        accessibilityViewIsModal
        aria-label={dialog.title}
        width="100%"
        maxWidth={440}
        gap="$3"
        padding="$4"
        borderRadius="$5"
        backgroundColor="$background"
        borderWidth={1}
        borderColor="$borderColor"
      >
        <Text fontWeight="700" fontSize="$5">
          {dialog.title}
        </Text>
        {dialog.message ? <Paragraph fontSize="$3">{dialog.message}</Paragraph> : null}
        <XStack gap="$2" justifyContent="flex-end" flexWrap="wrap">
          {dialog.buttons.map((b, i) => (
            <Button
              key={`${i}-${b.text ?? ''}`}
              size="$3"
              hitSlop={HIT_SLOP}
              theme={b.style === 'destructive' ? 'red' : b.style === 'cancel' ? undefined : 'blue'}
              chromeless={b.style === 'cancel'}
              onPress={() => pressDialogButton(dialog.id, i)}
            >
              {b.text ?? i18n.t('actions.ok')}
            </Button>
          ))}
        </XStack>
      </YStack>
    </View>
  );
}
