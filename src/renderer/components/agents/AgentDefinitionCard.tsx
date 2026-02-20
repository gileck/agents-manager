import React from 'react';
import type { AgentDefinition } from '../../../shared/types';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Pencil, Trash2 } from 'lucide-react';

interface AgentDefinitionCardProps {
  definition: AgentDefinition;
  onEdit: (definition: AgentDefinition) => void;
  onDelete: (definition: AgentDefinition) => void;
}

export function AgentDefinitionCard({ definition, onEdit, onDelete }: AgentDefinitionCardProps) {
  return (
    <Card className="transition-colors">
      <CardContent className="py-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium">{definition.name}</span>
              <Badge variant="outline">{definition.engine}</Badge>
              {definition.isBuiltIn && <Badge variant="secondary">Built-in</Badge>}
              {definition.model && <Badge variant="secondary">{definition.model}</Badge>}
            </div>
            {definition.description && (
              <p className="text-sm text-muted-foreground mb-2">{definition.description}</p>
            )}
            <div className="flex gap-1.5 flex-wrap">
              {definition.modes.map((m) => (
                <Badge key={m.mode} variant="outline" className="text-xs">
                  {m.mode}
                </Badge>
              ))}
            </div>
            {definition.skills.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mt-1.5">
                {definition.skills.map((skill) => (
                  <Badge key={skill} variant="secondary" className="text-xs font-mono">
                    /{skill}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 ml-4 flex-shrink-0">
            <Button variant="ghost" size="icon" onClick={() => onEdit(definition)}>
              <Pencil className="h-4 w-4" />
            </Button>
            {!definition.isBuiltIn && (
              <Button variant="ghost" size="icon" onClick={() => onDelete(definition)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
