import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDrivers, createDriver, updateLocation, updateAvailability } from '../api/drivers';
import DriverCard from '../components/DriverCard';
import type { Driver } from '../types';

export default function DriverView() {
  const queryClient = useQueryClient();
  const [locationInputs, setLocationInputs] = useState<Record<string, { lat: string; lng: string }>>({});
  const [newDriver, setNewDriver] = useState<Partial<Driver>>({ name: '', phone: '', vehicleType: '' });
  const [formError, setFormError] = useState('');

  const { data: drivers = [], isLoading } = useQuery({
    queryKey: ['drivers'],
    queryFn: getDrivers,
  });

  const availabilityMutation = useMutation({
    mutationFn: ({ id, available }: { id: string; available: boolean }) =>
      updateAvailability(id, available),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drivers'] }),
  });

  const locationMutation = useMutation({
    mutationFn: ({ id, lat, lng }: { id: string; lat: number; lng: number }) =>
      updateLocation(id, lat, lng),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drivers'] }),
  });

  const createDriverMutation = useMutation({
    mutationFn: createDriver,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      setNewDriver({ name: '', phone: '', vehicleType: '' });
      setFormError('');
    },
    onError: () => setFormError('Failed to register driver.'),
  });

  const handleRegister = () => {
    if (!newDriver.name?.trim() || !newDriver.phone?.trim() || !newDriver.vehicleType?.trim()) {
      setFormError('All fields are required.');
      return;
    }
    createDriverMutation.mutate({ ...newDriver, available: true });
  };

  const handleUpdateLocation = (id: string) => {
    const loc = locationInputs[id];
    if (!loc) return;
    const lat = parseFloat(loc.lat);
    const lng = parseFloat(loc.lng);
    if (isNaN(lat) || isNaN(lng)) return;
    locationMutation.mutate({ id, lat, lng });
  };

  return (
    <div className="max-w-5xl mx-auto p-4">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Driver Portal</h1>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Drivers List */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="font-semibold text-gray-700">All Drivers</h2>
          {isLoading ? (
            <p className="text-gray-400 text-sm">Loading drivers…</p>
          ) : drivers.length === 0 ? (
            <p className="text-gray-400 text-sm">No drivers registered yet.</p>
          ) : (
            drivers.map((driver) => (
              <div key={driver.id} className="space-y-2">
                <DriverCard
                  driver={driver}
                  onToggleAvailability={(id, available) =>
                    availabilityMutation.mutate({ id, available })
                  }
                />
                {/* Location update */}
                <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-2">
                  <input
                    type="number"
                    placeholder="Latitude"
                    value={locationInputs[driver.id]?.lat ?? ''}
                    onChange={(e) =>
                      setLocationInputs((p) => ({
                        ...p,
                        [driver.id]: { ...p[driver.id], lat: e.target.value },
                      }))
                    }
                    className="border border-gray-300 rounded px-2 py-1 text-xs w-28 focus:outline-none"
                  />
                  <input
                    type="number"
                    placeholder="Longitude"
                    value={locationInputs[driver.id]?.lng ?? ''}
                    onChange={(e) =>
                      setLocationInputs((p) => ({
                        ...p,
                        [driver.id]: { ...p[driver.id], lng: e.target.value },
                      }))
                    }
                    className="border border-gray-300 rounded px-2 py-1 text-xs w-28 focus:outline-none"
                  />
                  <button
                    onClick={() => handleUpdateLocation(driver.id)}
                    disabled={locationMutation.isPending}
                    className="px-3 py-1 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white text-xs rounded"
                  >
                    Update Location
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Register New Driver */}
        <div className="bg-white border border-gray-200 rounded-xl shadow p-4 h-fit">
          <h2 className="font-semibold text-gray-700 mb-3">Register New Driver</h2>
          {formError && <p className="text-red-600 text-sm mb-2">{formError}</p>}
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Name"
              value={newDriver.name}
              onChange={(e) => setNewDriver((p) => ({ ...p, name: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <input
              type="text"
              placeholder="Phone"
              value={newDriver.phone}
              onChange={(e) => setNewDriver((p) => ({ ...p, phone: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <input
              type="text"
              placeholder="Vehicle type (e.g. Bike, Car)"
              value={newDriver.vehicleType}
              onChange={(e) => setNewDriver((p) => ({ ...p, vehicleType: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <button
              onClick={handleRegister}
              disabled={createDriverMutation.isPending}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white font-medium py-2 rounded-lg text-sm transition-colors"
            >
              {createDriverMutation.isPending ? 'Registering…' : 'Register Driver'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
