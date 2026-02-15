import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@template/renderer/components/ui/button';
import { Input } from '@template/renderer/components/ui/input';
import { Label } from '@template/renderer/components/ui/label';
import { Textarea } from '@template/renderer/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@template/renderer/components/ui/card';

export function ItemFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isEdit && id) {
      window.api.items.get(id).then(item => {
        if (item) {
          setName(item.name);
          setDescription(item.description || '');
        }
      });
    }
  }, [id, isEdit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      if (isEdit && id) {
        await window.api.items.update(id, { name, description });
      } else {
        await window.api.items.create({ name, description });
      }
      navigate('/items');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold mb-6">
          {isEdit ? 'Edit Item' : 'New Item'}
        </h1>

        <Card>
          <CardHeader>
            <CardTitle>Item Details</CardTitle>
            <CardDescription>
              {isEdit ? 'Update the item information' : 'Create a new item'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter item name"
                  required
                />
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter item description (optional)"
                  rows={4}
                />
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={loading || !name.trim()}>
                  {loading ? 'Saving...' : (isEdit ? 'Save Changes' : 'Create Item')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate('/items')}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
