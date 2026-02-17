import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@template/renderer/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@template/renderer/components/ui/card';
import type { Item } from '../../shared/types';

export function HomePage() {
  const [itemCount, setItemCount] = useState(0);
  const [version, setVersion] = useState('');

  useEffect(() => {
    window.api.items.list().then((items: Item[]) => setItemCount(items.length));
    window.api.app.getVersion().then(setVersion);
  }, []);

  return (
    <div className="p-8">
      <div className="max-w-4xl">
        <h1 className="text-4xl font-bold mb-2">Welcome to Agents Manager</h1>
        <p className="text-muted-foreground mb-8">
          A production-ready Electron template for macOS menu bar apps
        </p>

        <div className="grid gap-6 md:grid-cols-2 mb-8">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
              <CardDescription>Manage your items</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold mb-4">{itemCount}</div>
              <Link to="/items">
                <Button>View Items</Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <CardDescription>Configure your app</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Customize theme and preferences
              </p>
              <Link to="/settings">
                <Button variant="outline">Open Settings</Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Version {version}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
