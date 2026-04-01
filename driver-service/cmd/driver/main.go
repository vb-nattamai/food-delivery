// Package main is the entry point for the Driver Service.
// It exposes an HTTP API for driver profiles and location tracking,
// backed by MongoDB, with graceful shutdown on SIGINT/SIGTERM.
package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ─── Domain ───────────────────────────────────────────────────────────────────

// Driver represents a delivery driver stored in MongoDB.
type Driver struct {
	ID          primitive.ObjectID `bson:"_id,omitempty"    json:"id"`
	Name        string             `bson:"name"             json:"name"`
	Phone       string             `bson:"phone"            json:"phone"`
	VehicleType string             `bson:"vehicle_type"     json:"vehicleType"`
	IsAvailable bool               `bson:"is_available"     json:"isAvailable"`
	Location    *GeoPoint          `bson:"location"         json:"location,omitempty"`
	CreatedAt   time.Time          `bson:"created_at"       json:"createdAt"`
	UpdatedAt   time.Time          `bson:"updated_at"       json:"updatedAt"`
}

// GeoPoint stores a driver's current GPS coordinates.
type GeoPoint struct {
	Latitude  float64 `bson:"lat" json:"latitude"`
	Longitude float64 `bson:"lng" json:"longitude"`
}

// ─── Handler ──────────────────────────────────────────────────────────────────

type handler struct {
	drivers *mongo.Collection
	log     *slog.Logger
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/health":
		h.health(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/drivers":
		h.listDrivers(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/drivers":
		h.createDriver(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (h *handler) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *handler) listDrivers(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	onlyAvailable := r.URL.Query().Get("available") == "true"
	filter := bson.M{}
	if onlyAvailable {
		filter["is_available"] = true
	}

	cur, err := h.drivers.Find(ctx, filter)
	if err != nil {
		h.log.Error("listDrivers find", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer cur.Close(ctx)

	var drivers []Driver
	if err = cur.All(ctx, &drivers); err != nil {
		h.log.Error("listDrivers decode", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, drivers)
}

func (h *handler) createDriver(w http.ResponseWriter, r *http.Request) {
	var d Driver
	if err := json.NewDecoder(r.Body).Decode(&d); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	d.ID = primitive.NewObjectID()
	d.CreatedAt = time.Now().UTC()
	d.UpdatedAt = time.Now().UTC()

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	if _, err := h.drivers.InsertOne(ctx, d); err != nil {
		h.log.Error("createDriver insert", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusCreated, d)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	mongoURI := getenv("MONGO_URI", "mongodb://localhost:27017")
	mongoDB := getenv("MONGO_DB", "driverservice")
	addr := getenv("ADDR", ":8083")

	// Connect to MongoDB
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(mongoURI))
	if err != nil {
		log.Error("mongo connect", "err", err)
		os.Exit(1)
	}

	if err = client.Ping(ctx, nil); err != nil {
		log.Error("mongo ping", "err", err)
		os.Exit(1)
	}
	log.Info("connected to MongoDB", "uri", mongoURI, "db", mongoDB)

	// Create a 2dsphere index on location for geospatial queries
	collection := client.Database(mongoDB).Collection("drivers")
	indexModel := mongo.IndexModel{
		Keys: bson.D{{Key: "location", Value: "2dsphere"}},
	}
	if _, err = collection.Indexes().CreateOne(context.Background(), indexModel); err != nil {
		log.Warn("could not create 2dsphere index (may already exist)", "err", err)
	}

	h := &handler{drivers: collection, log: log}
	srv := &http.Server{
		Addr:         addr,
		Handler:      h,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Info("driver service listening", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("listen error", "err", err)
			os.Exit(1)
		}
	}()

	<-quit
	log.Info("shutting down gracefully…")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("server shutdown error", "err", err)
	}
	if err := client.Disconnect(shutdownCtx); err != nil {
		log.Error("mongo disconnect error", "err", err)
	}
	log.Info("driver service stopped")
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
