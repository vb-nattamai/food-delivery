import type { MenuItem } from '../types';
import { Plus } from 'lucide-react';

interface MenuItemCardProps {
  item: MenuItem;
  onAdd?: (item: MenuItem) => void;
}

export default function MenuItemCard({ item, onAdd }: MenuItemCardProps) {
  const outOfStock = item.stockQuantity === 0;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-between shadow-sm">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-800 truncate">{item.name}</p>
        <p className="text-xs text-gray-500 line-clamp-2">{item.description}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-sm font-semibold text-orange-600">${item.price.toFixed(2)}</span>
          <span className="text-xs text-gray-400">
            {item.stockQuantity === -1
              ? 'Unlimited'
              : outOfStock
              ? 'Out of stock'
              : `${item.stockQuantity} left`}
          </span>
        </div>
      </div>
      {onAdd && (
        <button
          onClick={() => onAdd(item)}
          disabled={outOfStock}
          className="ml-3 p-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white rounded-full transition-colors"
        >
          <Plus size={16} />
        </button>
      )}
    </div>
  );
}
