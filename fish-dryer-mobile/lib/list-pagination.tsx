import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';

export const LIST_PAGE_SIZE = 10;

export function useListPagination<T>(items: T[], pageSize = LIST_PAGE_SIZE) {
  const [page, setPage] = useState(1);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(items.length / pageSize)),
    [items.length, pageSize]
  );

  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  const resetPage = useCallback(() => setPage(1), []);

  return { pageItems, page: safePage, totalPages, setPage, resetPage };
}

type ListPaginationBarProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
};

export function ListPaginationBar({
  page,
  totalPages,
  onPageChange,
  totalItems,
}: ListPaginationBarProps) {
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <View style={paginationStyles.wrap}>
      <Text style={paginationStyles.label}>
        Page {page} of {totalPages}
        {totalItems != null ? ` · ${totalItems} items` : ''}
      </Text>

      <View style={paginationStyles.btnRow}>
        <TouchableOpacity
          style={[paginationStyles.btn, !canPrev && paginationStyles.btnDisabled]}
          onPress={() => onPageChange(page - 1)}
          disabled={!canPrev}
          activeOpacity={0.8}
        >
          <FontAwesome
            name="chevron-left"
            size={12}
            color={canPrev ? '#fff' : '#9aa5b1'}
          />
          <Text style={[paginationStyles.btnText, !canPrev && paginationStyles.btnTextDisabled]}>
            Previous
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[paginationStyles.btn, !canNext && paginationStyles.btnDisabled]}
          onPress={() => onPageChange(page + 1)}
          disabled={!canNext}
          activeOpacity={0.8}
        >
          <Text style={[paginationStyles.btnText, !canNext && paginationStyles.btnTextDisabled]}>
            Next
          </Text>
          <FontAwesome
            name="chevron-right"
            size={12}
            color={canNext ? '#fff' : '#9aa5b1'}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const paginationStyles = StyleSheet.create({
  wrap: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e8ecef',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1f3b57',
    textAlign: 'center',
    marginBottom: 10,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#1f3b57',
  },
  btnDisabled: {
    backgroundColor: '#dce3ea',
  },
  btnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  btnTextDisabled: {
    color: '#9aa5b1',
  },
});
