import type { Driver } from '../types';
import { MapPin, Phone, Truck } from 'lucide-react';

interface DriverCardProps {
  driver: Driver;
  onToggleAvailability?: (id: string, available: boolean) => void;
}

export default function DriverCard({ driver, onToggleAvailability }: DriverCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-800">{driver.name}</h3>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            driver.available ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {driver.available ? 'Available' : 'Unavailable'}
        </span>
      </div>
      <div className="space-y-1 text-sm text-gray-600 mb-3">
        <p className="flex items-center gap-1">
          <Phone size={14} /> {driver.phone}
        </p>
        <p className="flex items-center gap-1">
          <Truck size={14} /> {driver.vehicleType}
        </p>
        {driver.location && (
          <p className="flex items-center gap-1">
            <MapPin size={14} /> {driver.location.latitude.toFixed(4)},{' '}
            {driver.location.longitude.toFixed(4)}
          </p>
        )}
      </div>
      {onToggleAvailability && (
        <button
          onClick={() => onToggleAvailability(driver.id, !driver.available)}
          className={`w-full text-xs font-medium py-1.5 rounded transition-colors ${
            driver.available
              ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              : 'bg-green-500 hover:bg-green-600 text-white'
          }`}
        >
          {driver.available ? 'Mark Unavailable' : 'Mark Available'}
        </button>
      )}
    </div>
  );
}
